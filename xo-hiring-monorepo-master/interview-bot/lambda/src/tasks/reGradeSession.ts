import { DynamoDB } from '../integrations/dynamodb';
import { SqsGptReGradeSessionMessage } from '../integrations/sqs';
import { Session } from '../model/session';

export async function reGradeSession(message: SqsGptReGradeSessionMessage) {
  const session = await Session.getById(message.sessionId);
  if (session == null) {
    throw new Error(`Want to re-grade session but cannot find by id ${message.sessionId}`);
  }

  // Unset the error
  session.error = message.error ?? '';

  // Reset session state and save it
  session.state = 'Initializing';
  await DynamoDB.putDocument(session);

  // Moving to Completed will trigger onSessionCompleted logic in DDB stream that will do the grading
  session.state = 'Completed';
  await DynamoDB.putDocument(session);
}
