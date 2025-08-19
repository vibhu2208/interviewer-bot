import { AuthContext } from './auth-context';
import { APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { badResponse, unAuthorizedResponse } from './common';

export const forceResetPassword = async function (ctx: AuthContext): Promise<APIGatewayProxyResult> {
  if (ctx.payload?.password === undefined || ctx.payload?.password === '') {
    return badResponse({
      code: 'MissingRequiredParameter',
      message: `Missing required parameter 'password'`,
    });
  }
  if (ctx.payload?.id === undefined || ctx.payload?.id === '') {
    return badResponse({
      code: 'MissingRequiredParameter',
      message: `Missing required parameter 'id'`,
    });
  }

  try {
    await ctx.findUserByEmail();

    if (!ctx.user) {
      return unAuthorizedResponse({ code: 'AuthorizationError' });
    }
    if (ctx.user.Username !== ctx.payload?.id) {
      return unAuthorizedResponse({ code: 'AuthorizationError' });
    }
    if (!ctx.isUserConfirmed() || ctx.isUserEmailVerified()) {
      return unAuthorizedResponse({ code: 'AuthorizationError' });
    }

    await ctx.cognitoIdSp
      .adminSetUserPassword({
        Username: ctx.user.Username,
        Password: ctx.payload.password,
        Permanent: true,
        UserPoolId: process.env.USER_POOL_ID,
      })
      .promise();

    // email will always be non-verified in this case
    return badResponse({ code: 'UserNotVerified' });
  } catch (err) {
    console.log(`Auth context: ${JSON.stringify(ctx)}`);
    console.error(err);
    if (err.code === 'InvalidPasswordException') {
      return badResponse({ code: 'InvalidPasswordException', message: err.message });
    } else {
      return unAuthorizedResponse({ code: 'AuthorizationError' });
    }
  }
};
