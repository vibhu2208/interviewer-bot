import { defaultLogger } from '@trilogy-group/xoh-integration';
import {
  CognitoUserPoolTriggerEvent,
  PostAuthenticationTriggerEvent,
  PreSignUpTriggerEvent,
  UserMigrationTriggerEvent,
} from 'aws-lambda';
import { postAuthenticationTrigger } from '../events/post-authentication';
import { preSignUpEvent } from '../events/pre-signup';
import { MigrationNotRequiredError, userMigrationHandler } from '../events/user-migration';

export const log = defaultLogger({ serviceName: 'cognito-event-handler' });

export async function handleCognitoEvent(event: CognitoUserPoolTriggerEvent) {
  // Add contextual metadata to the logging
  log.resetKeys();
  log.appendKeys({
    candidateId: event.userName,
    type: event.triggerSource,
  });
  if (event.request?.userAttributes?.email != null) {
    log.appendKeys({
      email: event.request?.userAttributes?.email,
    });
  }
  log.logEventIfEnabled(event, true);

  try {
    switch (event.triggerSource) {
      case 'PostAuthentication_Authentication':
        return await postAuthenticationTrigger(event as unknown as PostAuthenticationTriggerEvent);
      case 'PreSignUp_AdminCreateUser':
      case 'PreSignUp_SignUp':
      case 'PreSignUp_ExternalProvider':
        return await preSignUpEvent(event as unknown as PreSignUpTriggerEvent);
      case 'UserMigration_Authentication':
      case 'UserMigration_ForgotPassword':
        return await userMigrationHandler(event as unknown as UserMigrationTriggerEvent);
      default:
        log.info(`Unhandled event: ${event.triggerSource}`, { event });
    }
  } catch (error) {
    if (!(error instanceof MigrationNotRequiredError)) {
      log.error(`${error}`, error as Error);
    }

    throw error;
  }

  return event;
}
