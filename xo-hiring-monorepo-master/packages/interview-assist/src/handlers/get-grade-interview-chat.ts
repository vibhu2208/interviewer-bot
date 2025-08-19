import { defaultLogger } from '@trilogy-group/xoh-integration';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { errorResponse, successResponse } from '../integrations/api-gateway';
import { Conversation } from '../models/conversation';

const log = defaultLogger({ serviceName: 'get-grade-interview-chat' });

export async function handler(event: APIGatewayProxyWithCognitoAuthorizerEvent): Promise<APIGatewayProxyResult> {
  log.resetKeys();

  const asrId = event.pathParameters?.asrId;
  if (asrId == null) {
    return errorResponse(400, 'ASR ID is required');
  }

  log.appendKeys({ asrId });
  log.info(`Getting conversation for ASR ID: ${asrId}`);
  const conversation = await Conversation.getByAsrId(asrId);

  if (conversation == null) {
    log.warn(`Conversation ${asrId} not found`);
    return errorResponse(404, `Conversation ${asrId} not found`);
  }

  return successResponse({ messages: conversation.messages ?? [], isComplete: conversation.isComplete });
}
