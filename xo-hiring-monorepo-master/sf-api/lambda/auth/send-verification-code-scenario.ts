import { AuthContext } from './auth-context';
import { APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { badResponse, defaultResponse, unAuthorizedResponse } from './common';

type ExecutionMode = 'VerificationCode' | 'ConfirmationCode';

export const sendVerificationCode = async function (ctx: AuthContext): Promise<APIGatewayProxyResult> {
  let executionMode: ExecutionMode = 'VerificationCode';
  await ctx.findUserByEmail();

  if (ctx.user) {
    if (ctx.isUserConfirmed()) {
      // Password is required for getUserAttributeVerificationCode action
      if (ctx.payload?.password === undefined || ctx.payload?.password === '') {
        return badResponse({ code: 'PasswordRequired' });
      }
    } else {
      executionMode = 'ConfirmationCode';
    }
  } else {
    return defaultResponse;
  }

  try {
    if (executionMode === 'ConfirmationCode') {
      await ctx.cognitoIdSp
        .resendConfirmationCode({
          Username: ctx.user.Username,
          ClientId: process.env.CLIENT_ID,
        })
        .promise();
    } else {
      if ((await ctx.authenticateUser()) === 'Success') {
        await ctx.cognitoIdSp
          .getUserAttributeVerificationCode({
            AccessToken: ctx.authResponse?.AuthenticationResult?.AccessToken,
            AttributeName: 'email',
          })
          .promise();
      } else {
        console.log(`Auth context: ${JSON.stringify(ctx)}`);
        return unAuthorizedResponse({ code: 'AuthorizationError' });
      }
    }
  } catch (err) {
    // Log error and return successful response to the caller
    console.log(`Auth context: ${JSON.stringify(ctx)}`);
    console.error(err);
  }

  return defaultResponse;
};
