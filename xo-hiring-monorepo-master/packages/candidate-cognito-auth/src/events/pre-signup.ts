import { Salesforce } from '@trilogy-group/xoh-integration';
import { PreSignUpTriggerEvent } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { log } from '../handlers/cognito-event-handler';
import { CognitoService } from '../services/cognito-service';

export async function preSignUpEvent(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  // Bypass validation (created from CICD and SSO PreSignUp)
  if (
    event.triggerSource == 'PreSignUp_AdminCreateUser' &&
    event.request.validationData?.['SkipValidation'] === 'true'
  ) {
    if (event.request.validationData?.['AutoConfirm'] === 'true') {
      event.response.autoConfirmUser = true;
      event.response.autoVerifyEmail = true;
      event.response.autoVerifyPhone = true;
    }
    return event;
  }

  if (event.triggerSource === 'PreSignUp_ExternalProvider') {
    // SSO signup flow
    return await preSignUpSSO(event);
  } else {
    // Normal signup flow
    return await preSignUpNormalUser(event);
  }
}

/**
 * SSO first-time login entry point.
 * Connects SSO user with the normal Cognito user
 * Optionally:
 *  - Creates missing Salesforce user
 *  - Creates missing normal Cognito user
 * @param event Cognito event
 */
async function preSignUpSSO(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  const email = event.request.userAttributes?.email;
  if (email == null) {
    throw new Error(`Email is not provided for the SSO pre signup`);
  }

  let sfUser: SalesforceUser | null = null;

  // 1. Check if we already have Cognito user for this email
  const cognito = new CognitoService(event.userPoolId);
  let cognitoUser = await cognito.findUserByEmail(email);

  // Create basic Cognito user if we don't have one
  if (cognitoUser == null) {
    // First, determine if there is already an account for such email in Salesforce
    const sf = await Salesforce.getDefaultClient();
    const sfAccountsByEmail = await sf.querySOQL<SalesforceUser>(
      `SELECT Id, Successful_Login_Count__c FROM Account WHERE PersonEmail = '${email}'`,
    );
    if (sfAccountsByEmail.length > 1) {
      log.error(`Multiple SF accounts detected for email`, {
        accounts: sfAccountsByEmail.map((it) => it.Id),
      });
      throw new Error(`Multiple accounts detected for email: ${sfAccountsByEmail[0]}`);
    }

    if (sfAccountsByEmail.length === 0) {
      // Create a new Salesforce user
      const userData = {
        FirstName: event.request.userAttributes?.given_name,
        LastName: event.request.userAttributes?.family_name,
        PersonEmail: email,
      };
      log.info(`Creating a new Salesforce user based on SSO`, {
        user: userData,
      });
      const createdUser = await sf.createObject('Account', userData);
      if (createdUser.data.id != null) {
        log.appendKeys({
          candidateId: createdUser.data.id,
        });
        sfAccountsByEmail.push({
          Id: createdUser.data.id,
          Successful_Login_Count__c: 0,
        });
        log.info(`Created Salesforce user with id ${createdUser.data.id}`);
      } else {
        log.error(`Failed to create Salesforce user`, {
          user: userData,
          response: createdUser.data,
        });
        throw new Error(`Failed to create Salesforce user`);
      }
    }

    // We should have one user here
    sfUser = sfAccountsByEmail[0];

    // Create a new Cognito user
    log.info(`Creating a new Cognito user for ${email} / ${sfUser.Id}`);
    cognitoUser = await cognito.createUser({
      Username: sfUser.Id,
      UserAttributes: [
        { Name: 'email', Value: email },
        // Cognito overrides email verified for the SSO logins. We would set it to true in the userinfo proxy as well
        { Name: 'email_verified', Value: 'true' },
        { Name: 'family_name', Value: event.request.userAttributes.family_name },
        { Name: 'given_name', Value: event.request.userAttributes.given_name },
        { Name: 'phone_number', Value: event.request.userAttributes.phone_number },
      ],
      MessageAction: 'SUPPRESS',
      DesiredDeliveryMediums: ['EMAIL'],
      ValidationData: [
        // This will trigger another PreSignUp event, forcing it to not perform any additional checks
        { Name: 'SkipValidation', Value: 'true' },
        { Name: 'AutoConfirm', Value: 'true' },
      ],
    });
    if (cognitoUser == null) {
      throw new Error(`Cannot create Cognito user`);
    }
    log.info(`Created Cognito user for ${email} / ${sfUser.Id}`, {
      cognitoUser,
    });

    if (cognitoUser.UserStatus === 'FORCE_CHANGE_PASSWORD') {
      // Now we need to set some random password for this new account to avoid FORCE_CHANGE_PASSWORD user status
      // This would allow user to use the normal "reset password" flow if he wants to access account with password later
      // This password should be secure enough and also comply with security settings, but we do not need to store it
      await cognito.setPassword(sfUser.Id, `${randomUUID()}ABC!@#123`);
      log.info(`Set random password for the ${email} / ${sfUser.Id}`);
    }
  }

  if (cognitoUser.Username == null) {
    throw new Error(`Cognito username is not defined`);
  }

  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;

  // Provider name is prefixed to the external id per Cognito conventions, so we can extract those
  const firstUnderscoreIndex = event.userName.indexOf('_');
  if (firstUnderscoreIndex === -1) {
    throw new Error(`Invalid userName format: ${event.userName}. Expected format: provider_externalUserId`);
  }
  const provider = event.userName.substring(0, firstUnderscoreIndex);
  const externalUserId = event.userName.substring(firstUnderscoreIndex + 1);

  const identities = cognitoUser.Attributes?.find((it) => it.Name === 'identities');
  if (identities?.Value != null) {
    // Check if the user is already connected to this provider
    const connections: {
      userId: string;
      providerName: string;
    }[] = JSON.parse(identities.Value);
    const existingConnection = connections.find((it) => it.providerName === provider);
    if (existingConnection != null) {
      log.info(
        `User ${cognitoUser.Username} already has connection to the ${provider} SSO provider (as ${existingConnection.userId})`,
      );
      return event;
    }
  }

  const ssoOptions = {
    cognitoUsername: cognitoUser.Username,
    ssoProviderName: provider,
    ssoProviderUserId: externalUserId,
  };
  log.info(`Linking SSO from ${provider} to the Cognito user ${cognitoUser.Username}`, {
    options: ssoOptions,
  });
  await cognito.linkSSOToExistingUser(ssoOptions);

  // PreAuthentication event will not be fired for the first-time SSO SignUp, but the user will be logged in
  // We need to update the state in the Salesforce
  const sf = await Salesforce.getDefaultClient();
  if (sfUser == null) {
    sfUser = (
      await sf.querySOQL<SalesforceUser>(
        `SELECT Id, Successful_Login_Count__c FROM Account WHERE Id = '${cognitoUser.Username}'`,
      )
    )[0];
  }
  if (sfUser != null) {
    await sf.updateObject('Account', sfUser.Id, {
      Successful_Login_Count__c: (sfUser.Successful_Login_Count__c ?? 0) + 1,
      Last_Successful_Login__c: Date.now(),
    });
  }

  return event;
}

/**
 * Normal user sign-up flow. Designed to work in a way that Salesforce account must already be present when Cognito user is created.
 * This is a normal (non-sso) apply flow, where Apply flow will be called, creating the Salesforce user first
 * @param event
 */
async function preSignUpNormalUser(event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> {
  const sfClient = await Salesforce.getDefaultClient();
  const sfAccounts = await sfClient.querySOQL<{ Id: string; PersonEmail: string }>(`
      SELECT Id, PersonEmail
      FROM Account
      WHERE Id = '${event.userName}' OR PersonEmail = '${event.request.userAttributes.email}'`);

  if (sfAccounts.length === 0) {
    throw new Error('Cannot create user, account not found');
  }

  let found = false;
  for (const candidate of sfAccounts) {
    if (candidate.PersonEmail == event.request.userAttributes.email) {
      if (candidate.Id == event.userName) {
        log.info(`Found matching salesforce account with ID: ${candidate.Id}`);
        found = true;
        break;
      } else {
        log.error(`Email belongs to a different salesforce account: ${candidate.Id}`);
      }
    } else if (candidate.Id == event.userName) {
      log.error(`Salesforce user with such id has different email: ${candidate.PersonEmail}`);
    }
  }

  if (!found) {
    throw new Error('Cannot create user, account is not matched');
  }

  event.response.autoConfirmUser = false;
  event.response.autoVerifyEmail = false;
  event.response.autoVerifyPhone = false;

  return event;
}

interface SalesforceUser {
  Id: string;
  Successful_Login_Count__c: number;
}
