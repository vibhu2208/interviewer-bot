import { Salesforce } from '@trilogy-group/xoh-integration';
import { PostAuthenticationTriggerEvent } from 'aws-lambda';
import { log } from '../handlers/cognito-event-handler';

const DEFAULT_COGNITO_VALUE = 'cognito:default_val';

export async function postAuthenticationTrigger(
  event: PostAuthenticationTriggerEvent,
): Promise<PostAuthenticationTriggerEvent> {
  try {
    if (event.request.userAttributes.email === DEFAULT_COGNITO_VALUE) {
      // Impersonation users don't have an email set, but it's mandatory to set an email for candidates.
      // This is a simple way to differentiate them, and skip calling SalesForce.
      log.info(`Skip post-authentication for this user, default email detected`);
    } else {
      const query = `SELECT Successful_Login_Count__c FROM Account WHERE Id='${event.userName}' LIMIT 1`;
      const sfClient = await Salesforce.getDefaultClient();
      const sfAccounts = await sfClient.querySOQL<{ Successful_Login_Count__c: number }>(query);

      if (sfAccounts.length === 0) {
        // this should not happen, unless Account record is deleted from SF after Cognito migration.
        log.error(`Cannot find Salesforce account with if ${event.userName}`);
        return event;
      }

      const account = sfAccounts[0];
      await sfClient.updateObject('Account', event.userName, {
        Successful_Login_Count__c: account.Successful_Login_Count__c + 1,
        Last_Successful_Login__c: Date.now(),
      });
    }
  } catch (error) {
    // Log additional information in case of an error, and return successfully to not block user from sign-in
    log.error('Post-authentication lambda error', { event, error });
  }

  return event;
}
