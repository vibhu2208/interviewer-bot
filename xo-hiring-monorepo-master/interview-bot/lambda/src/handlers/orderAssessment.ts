import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuid } from 'uuid';
import { Logger } from '../common/logger';
import { Config } from '../config';
import { DynamoDB } from '../integrations/dynamodb';
import { Sqs } from '../integrations/sqs';
import { CalibratedQuestion, ValidStatuses } from '../model/calibrated-question';
import { Session } from '../model/session';
import { Skill } from '../model/skill';
import { ABTestingService } from '../services/ab-testing.service';
import { ObservabilityService } from '../services/observability.service';

const log = Logger.create('orderAssessment');

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  log.plain('EVENT', event);

  const input: OrderAssessmentRequest = JSON.parse(event.body ?? '{}');

  // Fetch skill from the DB
  const skill = await Skill.getById(input.test_id);
  if (!skill) {
    log.error(`Cannot find skill: ${input.test_id}`);
    return {
      statusCode: 404,
      body: '',
    };
  }

  // Fetch calibrated questions to ensure we have enough
  const calibratedQuestions = await CalibratedQuestion.getAllForSkill(skill.id);
  const filtered = calibratedQuestions.filter((it) => ValidStatuses.includes(it.status));
  if (filtered.length < skill.questionsPerSession) {
    log.warn(`Not enough calibrated questions for skill: ${input.test_id}`);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: `Not enough calibrated questions in the valid status (${filtered.length}) for skill '${skill.name}'`,
      }),
    };
  }

  // Create a new session
  const sessionDocument = Session.newDocument({
    externalOrderId: input.order_id,
    skillId: skill.id,
    state: 'Initializing',
    secretKey: uuid(),
    testTaker: {
      name: `${input.candidate.first_name} ${input.candidate.last_name}`,
      email: input.candidate.email,
    },
    externalCallbackUrl: input.callback_url,
    durationLimit: input.duration ?? Config.getDefaultSessionDuration(),
    isTimeboxed: input.timeboxed ?? Config.getDefaultSessionTimeboxed(),
    // Our internal scoring uses 0-10 range. Convert 0-100 to 1-10
    noDelayIfScoreAbove: input.no_delay_if_score_above != null ? input.no_delay_if_score_above / 10.0 : undefined,
    // Determine A/B test experiment group based on candidate test group
    experiment_group: ABTestingService.determineExperimentGroup(input.candidate.test_group),
  });
  await DynamoDB.putDocument(sessionDocument);

  // Track session creation for A/B test monitoring
  if (sessionDocument.experiment_group) {
    try {
      await ObservabilityService.trackSessionCreated(sessionDocument.experiment_group, skill.id);
    } catch (e) {
      log.warn('Failed to track session creation metric', e, { sessionId: sessionDocument.id });
    }
  }

  log.info(`Created a new session for external id ${sessionDocument.externalOrderId}`, {
    sessionId: sessionDocument.id,
  });

  // Prepare questions for the session
  await Sqs.triggerPrepareSession(sessionDocument.id);

  // Result
  const gradingReportUrl = Session.gradingReportUrl(sessionDocument);
  const response: OrderAssessmentResponse = {
    assessment_id: sessionDocument.id,
    assessment_url: `${Config.getFrontendUrl()}/landing?sessionId=${sessionDocument.id}`,
    assessment_result_url: gradingReportUrl,
  };

  return {
    statusCode: 201,
    body: JSON.stringify(response),
  };
}

// Ref: https://docs.google.com/document/d/1BUZi8w5O07-55TSTyiDFnV2KyjAn7HO2JQ3Yjy7IJJE/edit
export interface OrderAssessmentRequest {
  /**
   * Unique assessment id that identifies the assessment in the Vendor's system
   */
  test_id: string;
  /**
   * The URL to which the vendor should publish the results once the assessment is finished
   * (if this is not supported, see the comment on order_id below)
   */
  callback_url?: string;
  /**
   * URL to show after the assessment is submitted by the candidate
   */
  redirect_url?: string;
  /**
   * This can be used by the vendor to uniquely identify an order
   * Note: Crossover may ask the Vendor for the same Candidate to take the same test multiple times - if this is the case,
   * Crossover will specify a new order_id each time, and the vendor will treat this as a new assessment instance
   *
   * Note: If the vendor does not support dynamic callback registration,
   * they must support appending this order_id to a static callback URL (see example below)
   */
  order_id: string;
  /**
   * Additional feature: If the score is above the specific threshold, the vendor should not delay the results
   * The score is passed in the 0-100 number which is a percentage from the max possible score (i.e. 75 is 75%)
   */
  no_delay_if_score_above: number | null;
  /**
   * Candidate information
   */
  candidate: {
    first_name: string;
    last_name: string;
    /**
     * Used to serve as a unique identifier for the candidate
     */
    email: string;
    /**
     * 2 lower-case letter ISO country name
     */
    country: string;
    /**
     * Candidate's test group (0 to 11)
     * Used to determine which experiment group should be used for this session
     */
    test_group?: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11';
    /**
     * Candidate's unique identifier in the vendor's system
     */
    candidate_id?: string;
  };
  /**
   * LAMBDA-70593: Test duration (minutes)
   */
  duration: number | null;
  /**
   * LAMBDA-70593: Test timeboxed status
   */
  timeboxed: boolean | null;
  /**
   * Pipeline ID to use for this assessment
   */
  pipeline_id?: string;
}

export interface OrderAssessmentResponse {
  /**
   * URL that will be used by the candidate to take the assessment
   * Contains any Single-Sign-On token or unique ID for the candidate to login automatically
   */
  assessment_url: string;
  /**
   * Unique Assessment Instance id in the Vendor's system
   */
  assessment_id: string;
  /**
   * Pre-filled with the assessment result url
   */
  assessment_result_url: string;
}
