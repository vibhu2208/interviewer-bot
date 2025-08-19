import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';
import { CoreMessage } from 'ai';
import {
  APIGatewayProxyResult,
  APIGatewayProxyWithCognitoAuthorizerEvent,
  APIGatewayProxyWithLambdaAuthorizerEvent,
} from 'aws-lambda';
import Handlebars from 'handlebars';
import { errorResponse, successResponse } from '../integrations/api-gateway';
import { Interviewer } from '../models/interviewer';
import { Summary } from '../models/summary';
import { Conversation } from '../models/conversation';
import { SfAuthorizerContext } from './authorizer';
import { instructions } from './get-summary.instructions';

const log = defaultLogger({ serviceName: 'get-summary' });

/**
 * @see Deployment — [Source]({@link ../../../../deploy/src/deployments/interview-assist/interview-assist-deployment.ts})
 * @param event
 * @returns
 */
export async function handler(
  event: APIGatewayProxyWithCognitoAuthorizerEvent | APIGatewayProxyWithLambdaAuthorizerEvent<SfAuthorizerContext>,
): Promise<APIGatewayProxyResult> {
  if (!isAuthorized(event)) {
    return errorResponse(403, 'You are not authorized to access this endpoint');
  }

  log.resetKeys();

  // Get ASR ID from path parameter
  const asrId = event.pathParameters?.asrId;

  if (!asrId) {
    log.error('ASR ID is required', { pathParameters: event.pathParameters });
    return errorResponse(400, 'ASR ID is required');
  }

  log.appendKeys({ asrId });

  const interview = await getInterviewByAsrId(asrId);
  if (!interview) {
    // This should never happen unless there is a bug on frontend or called directly
    log.warn('Interview not found for ASR ID', { asrId });
    return errorResponse(404, `Interview not found for ASR ID ${asrId}`);
  }

  // Run all queries in parallel to save time
  const graderId = interview.Grader__r.Id;
  const [interviewers, summaryDocument, conversation] = await Promise.all([
    Interviewer.getByIds([graderId]),
    Summary.getByAsrId(asrId),
    Conversation.getByAsrId(asrId),
  ]);

  // Determine if interviewer is onboarded
  const isOnboarded = interviewers.length > 0 && interviewers[0].isOnboarded;

  // Prepare response data
  const responseData: InterviewSummary = {
    isOnboarded,
    conversation: conversation?.messages || null,
  };

  // If not onboarded, add instructions
  if (!isOnboarded) {
    responseData.instructions = Handlebars.compile(instructions)({ graderId });
  }

  // If onboarded or we have summary data, add it to response
  if (summaryDocument) {
    responseData.summary = summaryDocument.summary;
    responseData.readAiUrl = summaryDocument.reportUrl;
  }

  // Return 404 only if both summary and conversation are missing
  if (!summaryDocument && !conversation) {
    log.info('Neither interview summary nor conversation found for ASR ID', { asrId });
    return errorResponse(404, `No data found for ASR ID ${asrId}`);
  }

  // Single success response point
  return successResponse(responseData);
}

function isAuthorized(
  event: APIGatewayProxyWithCognitoAuthorizerEvent | APIGatewayProxyWithLambdaAuthorizerEvent<SfAuthorizerContext>,
) {
  // get user groups from authorizer: either cognito or custom lambda authorizer
  try {
    const userGroups = (
      ('claims' in event.requestContext.authorizer
        ? event.requestContext.authorizer.claims['cognito:groups']
        : event.requestContext.authorizer.userGroups) ?? []
    ).split(',');

    return userGroups?.includes('admin') || userGroups?.includes('hm');
  } catch (error) {
    log.error('Error getting user groups', { error, event });
    return false;
  }
}

async function getInterviewByAsrId(asrId: string) {
  const sf = await Salesforce.getAdminClient();

  // Get interview ASR from Salesforce
  const interviews = await sf.querySOQL<ASR>(`
    SELECT
      Grader__r.Id
    FROM Application_Step_Result__c
    WHERE Id = '${asrId}' AND Application_Stage__c = 'Interview'
  `);

  return interviews[0] || null;
}

export interface ASR {
  Grader__r: {
    Id: string;
  };
}

export interface InterviewSummary {
  isOnboarded: boolean;
  summary?: string;
  readAiUrl?: string;
  instructions?: string;
  conversation?: CoreMessage[] | null;
}
