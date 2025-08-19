import { UpdateCommandInput } from '@aws-sdk/lib-dynamodb/dist-types/commands/UpdateCommand';
import { v4 as uuid } from 'uuid';
import { Logger } from '../common/logger';
import { Config } from '../config';
import { Crossover } from '../integrations/crossover';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';
import { Sqs, SqsStatusEventMessage } from '../integrations/sqs';
import { Ssm } from '../integrations/ssm';
import { StepFunctions } from '../integrations/step-functions';
import { Grading, Question, QuestionDocument } from './question';

const log = Logger.create('session');

export type SessionState = 'Initializing' | 'Ready' | 'Started' | 'Completed' | 'Graded';

export type SessionError = 'Abandoned' | 'CannotPickQuestions' | string;

export const ExperimentGroup = {
  Group1: 'group-1',
  Group2: 'group-2',
  Group3: 'group-3',
  Group4: 'group-4',
} as const;
export type ExperimentGroup = typeof ExperimentGroup[keyof typeof ExperimentGroup];

export interface SessionDocument extends MainTableKeys {
  id: string;
  externalOrderId: string;
  externalCallbackUrl?: string;
  secretKey?: string;
  state: SessionState;
  skillId: string;
  testTaker: {
    name: string;
    email: string;
  };
  /**
   * Session duration limit in minutes
   */
  durationLimit: number;
  /**
   * Flag that indicates whether the session is timeboxed or not
   * If session is timeboxed the session expiration happens right after the session duration expires ("hard limit")
   * If session is not timeboxed, the expiration time is multiplied by configured factor stealthily ("soft limit")
   * @see {Config.getNonTimeboxedSessionDurationMultiplier}
   */
  isTimeboxed: boolean;
  /**
   * Do not delay the status event if the score is above this threshold (internal scores in the 0-10 range)
   */
  noDelayIfScoreAbove?: number;
  /**
   * A/B test variant for routing to different interview flows
   * Used to determine which interview variant should be used for this session
   */
  experiment_group?: ExperimentGroup;
  startTime?: string;
  endTime?: string;
  grading?: Grading;
  gradedQuestionsCount?: number;
  totalQuestionsCount?: number;
  error?: SessionError;
  feedback?: {
    perception: 'Good' | 'Neutral' | 'Bad';
    comment?: string;
  };
  sessionEvents?: {
    time: string;
    type: 'tabVisibilityLost';
  }[];
}

export function getSessionKey(sessionId: string): MainTableKeys {
  return {
    pk: `SESSION#${sessionId}`,
    sk: `SESSION`,
  };
}

export function isSessionDocument(document: MainTableKeys | null): document is SessionDocument {
  return (document?.pk?.startsWith('SESSION#') && document?.sk === 'SESSION') ?? false;
}

export class Session {
  static newDocument(input: Omit<SessionDocument, 'pk' | 'sk' | 'id'>): SessionDocument {
    const id = uuid();
    return {
      id,
      ...getSessionKey(id),
      ...input,
    };
  }

  static async getById(sessionId: string): Promise<SessionDocument | null> {
    return await DynamoDB.getDocument<SessionDocument>(getSessionKey(sessionId));
  }

  static async setStateToReady(sessionId: string, questionsCount: number): Promise<boolean> {
    try {
      await DynamoDB.updateDocument({
        Key: getSessionKey(sessionId),
        UpdateExpression: 'SET #state = :newState, totalQuestionsCount = :count',
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':newState': 'Ready',
          ':prevState': 'Initializing',
          ':count': questionsCount,
        },
        ConditionExpression: '#state = :prevState',
      });
      return true;
    } catch (e) {
      // We will catch DynamoDB:ConditionalCheckFailedException if condition has not been satisfied
      log.warn(`Error while performing DDB operation`, e, { sessionId });
      return false;
    }
  }

  static async setStateToCompleted(sessionId: string, error?: SessionError): Promise<boolean> {
    try {
      await DynamoDB.updateDocument({
        Key: getSessionKey(sessionId),
        UpdateExpression: 'SET #state = :newState, #endTime = :endTime' + (error != null ? ', #error = :error' : ''),
        ExpressionAttributeNames: {
          '#state': 'state',
          '#endTime': 'endTime',
          '#error': 'error',
        },
        ExpressionAttributeValues: {
          ':newState': 'Completed',
          ':prevState': 'Started',
          ':error': error,
          ':endTime': new Date().toISOString(),
        },
        ConditionExpression: '#state = :prevState',
      });
      return true;
    } catch (e) {
      // We will catch DynamoDB:ConditionalCheckFailedException if condition has not been satisfied
      log.warn(`Error while performing DDB operation`, e, { sessionId });
      return false;
    }
  }

  static async setError(sessionId: string, error: SessionError): Promise<boolean> {
    try {
      await DynamoDB.updateDocument({
        Key: getSessionKey(sessionId),
        UpdateExpression: 'SET #error = :error',
        ExpressionAttributeNames: {
          '#error': 'error',
        },
        ExpressionAttributeValues: {
          ':error': error,
        },
      });
      return true;
    } catch (e) {
      log.warn(`Error while performing DDB operation`, e, { sessionId });
      return false;
    }
  }

  static async setStateToGraded(sessionId: string, grading: Grading, generateSecret = false): Promise<boolean> {
    try {
      const request: Omit<UpdateCommandInput, 'TableName'> = {
        Key: getSessionKey(sessionId),
        UpdateExpression: 'SET #state = :newState, #grading = :grading',
        ExpressionAttributeNames: {
          '#state': 'state',
          '#grading': 'grading',
        },
        ExpressionAttributeValues: {
          ':newState': 'Graded',
          ':prevState': 'Completed',
          ':grading': grading,
        },
        ConditionExpression: '#state = :prevState', // Prevent double-grading just in case
      };
      if (generateSecret) {
        // Generate and set secret key if required
        request.UpdateExpression += ', #secretKey = :secretKey';
        request.ExpressionAttributeNames!['#secretKey'] = 'secretKey';
        request.ExpressionAttributeValues![':secretKey'] = uuid();
      }
      await DynamoDB.updateDocument(request);
      return true;
    } catch (e) {
      // We will catch DynamoDB:ConditionalCheckFailedException if condition has not been satisfied
      log.warn(`Error while performing DDB operation`, e, { sessionId });
      return false;
    }
  }

  static async setGradedQuestionsCounter(id: string, value: number): Promise<SessionDocument> {
    return (
      await DynamoDB.updateDocument({
        Key: getSessionKey(id),
        UpdateExpression: 'SET gradedQuestionsCount = :val',
        ExpressionAttributeValues: {
          ':val': value,
        },
        ReturnValues: 'ALL_NEW',
      })
    ).Attributes as SessionDocument;
  }

  static async incrementGradedQuestionsCounter(id: string): Promise<SessionDocument> {
    return (
      await DynamoDB.updateDocument({
        Key: getSessionKey(id),
        UpdateExpression: 'ADD gradedQuestionsCount :inc',
        ExpressionAttributeValues: {
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    ).Attributes as SessionDocument;
  }

  /**
   * Should only be called when the session status changes!
   */
  static async sendStatusEvent(session: SessionDocument, questions?: QuestionDocument[]): Promise<void> {
    const logContext = { sessionId: session.id };
    if (session.externalCallbackUrl == null) {
      log.warn('Should send status message but externalCallbackUrl is not defined', logContext);
      return;
    }

    log.info(`Generating status event for session (state ${session.state})`, logContext);
    if (questions == null) {
      questions = session.state === 'Graded' ? await Question.getAllForSession(session.id) : [];
    }
    const statusEventPayload = Crossover.generateStatusEvent(session, questions);

    if (statusEventPayload == null) {
      return;
    }

    const sqsStatusMessage: SqsStatusEventMessage = {
      type: 'status-event',
      sessionId: session.id,
      callbackUrl: session.externalCallbackUrl,
      payload: statusEventPayload,
    };

    if (session.state === 'Graded') {
      // Fetch configuration for the delay
      const config = await Ssm.getForEnvironment();
      let delay = config.delayGradingEventsForSeconds;

      // See if we need to override the delay based on the score
      if (session.noDelayIfScoreAbove != null) {
        const score = session.grading?.score ?? 0;
        if (score >= session.noDelayIfScoreAbove) {
          log.info(
            `Score is above the threshold (${score} >= ${session.noDelayIfScoreAbove}), not delaying the status event`,
            logContext,
            {
              score,
              threshold: session.noDelayIfScoreAbove,
            },
          );
          // Force no delay
          delay = 0;
        }
      }

      if (delay > 0) {
        const executionName = `${session.id}_delayedStatusEvent_${Date.now()}`;
        log.info(`Starting execution of the Step Function to delay grading event`, logContext, {
          delaySeconds: delay,
          executionName: executionName,
        });
        await StepFunctions.sendDelayedQueueMessage(
          executionName,
          Config.getStatusEventQueueUrl(),
          sqsStatusMessage,
          delay,
        );
        return;
      }
      // Zero delay will be handled by the block below
    }

    if (session.state === 'Completed' || session.state === 'Graded') {
      await Sqs.sendStatusEventMessage(sqsStatusMessage);
    }
  }

  /**
   * Should only be called when the session status changes!
   * @param session
   */
  static async sendStatusEventSessionError(session: SessionDocument, message?: string): Promise<void> {
    const logContext = { sessionId: session.id };
    if (session.externalCallbackUrl == null) {
      log.warn('Should send error status message but externalCallbackUrl is not defined', logContext);
      return;
    }

    await Sqs.sendStatusEventMessage({
      type: 'status-event',
      sessionId: session.id,
      callbackUrl: session.externalCallbackUrl,
      payload: {
        status: 'rejected',
        assessment: {
          assessment_id: session.id,
          summary: message ?? 'Encountered error while performing assessment',
        },
      },
    });
  }

  static gradingReportUrl(session: SessionDocument): string {
    return `${Config.getFrontendUrl()}/grading-report?sessionId=${session.id}&detailed=true&secretKey=${
      session.secretKey
    }`;
  }
}
