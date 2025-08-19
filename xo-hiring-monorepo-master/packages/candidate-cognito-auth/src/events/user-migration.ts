import { UserMigrationTriggerEvent } from 'aws-lambda';
import { Salesforce } from '@trilogy-group/xoh-integration';
import { log } from '../handlers/cognito-event-handler';
import { CognitoService } from '../services/cognito-service';

export async function userMigrationHandler(event: UserMigrationTriggerEvent): Promise<UserMigrationTriggerEvent> {
  const inputCandidateId = event.request.validationData?.id ?? null;
  const cognitoService = new CognitoService(event.userPoolId);
  const cognitoUser = await cognitoService.findUserByEmail(event.userName);

  if (cognitoUser != null) {
    // This is a valid situation when logging in by email because email is a non-primary signup attribute
    throw new MigrationNotRequiredError('User already registered in cognito');
  }

  // Find Salesforce account
  const sf = await Salesforce.getDefaultClient();
  const sfAccounts = await sf.querySOQL<{
    Id: string;
    FirstName: string;
    LastName: string;
    Password__c: string;
    Phone: string;
  }>(`SELECT 
      Id, 
      FirstName, 
      LastName,
      Password__c,
      Phone 
    FROM Account 
    WHERE PersonEmail='${event.userName}' LIMIT 1`);

  if (sfAccounts.length === 0) {
    // We can get here if user attempts to "Forgot Password" for non-existent account
    log.info('No Salesforce account found for the provided email address');
    throw new MigrationNotRequiredError('Cannot find Salesforce account');
  }

  const candidate = sfAccounts[0];

  if (inputCandidateId == null) {
    if (event.triggerSource === 'UserMigration_Authentication' && candidate.Password__c !== event.request.password) {
      if (candidate.Password__c !== null) {
        // If candidate has password set in Salesforce, it means the legacy auth flow and the sole reason this migration exists
        // If the password does not match, log the warn message
        log.warn('Password mismatch during the UserMigration_Authentication');
      }
      throw new MigrationNotRequiredError('Password mismatch detected');
    }
  } else {
    if (candidate.Id !== inputCandidateId) {
      log.warn('Provided candidate ID does not match Salesforce account ID for the email');
      throw new MigrationNotRequiredError('Salesforce account mismatch detected');
    }
  }

  if (candidate.Phone === 'DELETED') {
    log.info('Salesforce account is marked as DELETED');
    throw new MigrationNotRequiredError('Salesforce account is deleted');
  }

  let isTrustedSource = false;
  if (event.triggerSource === 'UserMigration_Authentication') {
    const sources = (process.env.TRUSTED_SOURCES ?? '').split(',').map((item) => `'${item}'`);
    if (sources.length > 0) {
      const appQuery = `SELECT COUNT() FROM Opportunity WHERE AccountId='${
        candidate.Id
      }' AND LeadSource IN (${sources.join(',')})`;
      const appQueryResponse = await sf.querySOQL<{ expr0: number }>(appQuery);
      isTrustedSource = appQueryResponse.length > 0 && appQueryResponse[0].expr0 > 0;
    }
  }

  const emailVerified = event.triggerSource === 'UserMigration_ForgotPassword' || isTrustedSource;
  event.response.userAttributes = {
    username: candidate.Id,
    email: event.userName,
    phone_number: event.request.validationData?.phone ?? convertPhoneNumber(candidate.Phone),
    given_name: candidate.FirstName,
    family_name: candidate.LastName,
    email_verified: `${emailVerified}`,
  };
  event.response.finalUserStatus = 'CONFIRMED';
  event.response.messageAction = 'SUPPRESS';

  log.info('User migration successful', {
    response: event.response,
  });
  return event;
}

export class MigrationNotRequiredError extends Error {}

const convertPhoneNumber = function (phone: string): string {
  const sanitized = phone?.replace(/\D/gi, '');
  return sanitized && sanitized.length > 0 ? `+${sanitized}` : '';
};
