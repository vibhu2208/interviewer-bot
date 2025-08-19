import { AuthContext } from './auth-context';
import { APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { badResponse, defaultResponse, unAuthorizedResponse } from './common';

type ExecutionMode = 'VerifyAttribute' | 'ConfirmSignUp';

export const verifyEmail = async function (ctx: AuthContext): Promise<APIGatewayProxyResult> {
  if (ctx.payload?.code === undefined || ctx.payload?.code === '') {
    return badResponse({ code: 'MissingRequiredParameter', message: `Missing required parameter 'code'` });
  }

  let executionMode: ExecutionMode = 'VerifyAttribute';
  await ctx.findUserByEmail();

  if (ctx.user) {
    if (ctx.isUserConfirmed()) {
      // Password is required for verifyUserAttribute action
      if (ctx.payload?.password === undefined || ctx.payload?.password === '') {
        return badResponse({ code: 'PasswordRequired' });
      }
    } else {
      executionMode = 'ConfirmSignUp';
    }
  } else {
    return unAuthorizedResponse({ code: 'AuthorizationError' });
  }

  try {
    if (executionMode === 'ConfirmSignUp') {
      await ctx.cognitoIdSp
        .confirmSignUp({
          Username: ctx.user.Username,
          ConfirmationCode: ctx.payload.code,
          ClientId: process.env.CLIENT_ID,
        })
        .promise();
    } else {
      if ((await ctx.authenticateUser()) === 'Success') {
        await ctx.cognitoIdSp
          .verifyUserAttribute({
            AccessToken: ctx.authResponse?.AuthenticationResult?.AccessToken,
            AttributeName: 'email',
            Code: ctx.payload.code,
          })
          .promise();
      } else {
        console.log(`Auth context: ${JSON.stringify(ctx)}`);
      }
    }
  } catch (err) {
    console.log(`Auth context: ${JSON.stringify(ctx)}`);
    console.error(err);
    return unAuthorizedResponse({ code: 'AuthorizationError' });
  }

  return defaultResponse;
};
