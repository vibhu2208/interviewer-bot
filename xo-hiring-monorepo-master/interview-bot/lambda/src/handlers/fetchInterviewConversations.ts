import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../common/logger';
import {
  FetchInterviewConversationsRequestSchema,
  InterviewConversation,
} from '../model/interview-conversation.models';
import { fetchInterviewConversations as fetchInterviewConversationsService } from '../services/interview-conversation.service';

const log = Logger.create('fetchInterviewConversations-handler');

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  log.plain('EVENT', event);

  try {
    const requestBody = JSON.parse(event.body ?? '{}');
    const validationResult = FetchInterviewConversationsRequestSchema.safeParse(requestBody);

    if (!validationResult.success) {
      log.warn('Invalid request body', validationResult.error);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid request body',
          details: validationResult.error.flatten(),
        }),
      };
    }

    const interviewConversations: InterviewConversation[] = await fetchInterviewConversationsService(
      validationResult.data.sessionIds,
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ interviewConversations }),
    };
  } catch (error: unknown) {
    log.error('Error processing fetchInterviewConversations request:', error);

    let errorMessage = 'An unexpected error occurred.';
    if (error instanceof SyntaxError) {
      errorMessage = 'Invalid JSON in request body.';
      return {
        statusCode: 400,
        body: JSON.stringify({ error: errorMessage }),
      };
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to retrieve matching interview logs.', details: errorMessage }),
    };
  }
}
