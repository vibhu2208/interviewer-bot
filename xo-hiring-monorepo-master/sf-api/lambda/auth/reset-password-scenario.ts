import { AuthContext } from './auth-context';
import { APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { badResponse, defaultResponse, unAuthorizedResponse } from './common';

export const resetPassword = async function (ctx: AuthContext): Promise<APIGatewayProxyResult> {
  if (ctx.payload?.password === undefined || ctx.payload?.password === '') {
    return badResponse({ code: 'MissingRequiredParameter', message: `Missing required parameter 'password'` });
  }
  if (ctx.payload?.code === undefined || ctx.payload?.code === '') {
    return badResponse({ code: 'MissingRequiredParameter', message: `Missing required parameter 'code'` });
  }

  try {
    await ctx.findUserByEmail();

    if (ctx.user) {
      await ctx.cognitoIdSp
        .confirmForgotPassword({
          Username: ctx.user.Username,
          Password: ctx.payload.password,
          ConfirmationCode: ctx.payload.code,
          ClientId: process.env.CLIENT_ID,
        })
        .promise();
    }
  } catch (err) {
    console.log(`Auth context: ${JSON.stringify(ctx)}`);
    console.error(err);
    if (err.code === 'InvalidPasswordException') {
      return badResponse({ code: 'InvalidPasswordException', message: err.message });
    } else {
      return unAuthorizedResponse({ code: 'AuthorizationError' });
    }
  }

  return defaultResponse;
};
