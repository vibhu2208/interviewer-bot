import { AuthContext } from './auth-context';
import { APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { badResponse, defaultResponse, unAuthorizedResponse } from './common';
import { InitiateAuthRequest, InitiateAuthResponse } from 'aws-sdk/clients/cognitoidentityserviceprovider';

export const signIn = async function (ctx: AuthContext): Promise<APIGatewayProxyResult> {
  if (ctx.payload?.password === undefined || ctx.payload?.password === '') {
    return badResponse({
      code: 'MissingRequiredParameter',
      message: `Missing required parameter 'password'`,
    });
  }
  return await initiateAuth(ctx, {
    AuthParameters: {
      USERNAME: ctx.payload?.email,
      PASSWORD: ctx.payload?.password,
    },
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: process.env.CLIENT_ID,
  });
};

export const initiateAuth = async function (
  ctx: AuthContext,
  initiateAuthRequest: InitiateAuthRequest,
  maxRetries = 1,
): Promise<APIGatewayProxyResult> {
  let initiateAuthResponse: InitiateAuthResponse;
  try {
    initiateAuthResponse = await ctx.cognitoIdSp.initiateAuth(initiateAuthRequest).promise();
    console.log(`initiateAuthResponse: ${JSON.stringify(initiateAuthResponse)}`);
  } catch (err) {
    console.log(`Auth context: ${JSON.stringify(ctx)}`);
    console.error(err);
    if (err.code === 'UserNotFoundException') {
      const message: string = err.message;
      if (message.includes('User does not exist')) {
        // user is created, but email is not verified
        return badResponse({ code: 'UserNotVerified' });
      } else if (message.includes('Invalid phone number format')) {
        if (maxRetries > 0) {
          if (initiateAuthRequest.ClientMetadata === undefined) {
            initiateAuthRequest.ClientMetadata = {
              phone: '',
            };
          } else {
            initiateAuthRequest.ClientMetadata['phone'] = '';
          }
          console.log(`Retry with empty phone number: ${JSON.stringify(initiateAuthRequest)}`);
          return await initiateAuth(ctx, initiateAuthRequest, maxRetries - 1);
        }
        return badResponse({ code: 'InvalidPhoneNumber' });
      } else if (message.includes('UserMigration failed with error')) {
        // check for user-migration lambda errors
        if (message.includes('UserFoundEmailNotVerified')) {
          return badResponse({ code: 'UserNotVerified' });
        } else if (message.includes('CandidateNotToBeMigrated')) {
          return badResponse({ code: 'CandidateNotToBeMigrated' });
        } else {
          return unAuthorizedResponse({ code: 'AuthorizationError' });
        }
      } else {
        return unAuthorizedResponse({ code: 'AuthorizationError' });
      }
    } else if (err.code === 'UserNotConfirmedException') {
      return badResponse({ code: 'UserNotVerified' });
    } else if (err.code === 'NotAuthorizedException') {
      return unAuthorizedResponse({ code: 'AuthorizationError' });
    } else {
      return unAuthorizedResponse({ code: 'AuthorizationError' });
    }
  }

  return {
    ...defaultResponse,
    body: JSON.stringify(initiateAuthResponse),
  };
};
