import { Logger } from '../common/logger';
import { SqsGptCheckSessionExpirationMessage } from '../integrations/sqs';
import { Session } from '../model/session';

const log = Logger.create('checkSessionExpiration');

/**
 * Evaluate user prompt for the prompt-engineering questions
 * Trigger AppSync subscription with results
 */
export async function checkSessionExpiration(message: SqsGptCheckSessionExpirationMessage): Promise<void> {
  const logContext = log.context(message);
  const session = await Session.getById(message.sessionId);
  if (session == null) {
    throw new Error(`Want to check session expiration but Session is null`);
  }

  // Check if current session status is Started
  if (session.state !== 'Started') {
    log.info(`Session is not in 'Started', skipping expiration check`, logContext);
    return;
  }

  log.info(`Session is expired, changing state to Completed`, logContext);

  // We assume that the current time is already past the expiration date, no need to calculate time difference
  await Session.setStateToCompleted(session.id, 'Abandoned');
}
