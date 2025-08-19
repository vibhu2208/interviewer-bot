import { AuthContext } from './auth-context';
import { APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { badResponse, defaultResponse } from './common';
import { completeSignUpFlow, Force } from './sf-utils';

export const sendResetPasswordCode = async function (ctx: AuthContext): Promise<APIGatewayProxyResult> {
  await ctx.findUserByEmail();

  if (ctx.user) {
    if (ctx.isUserEmailVerified()) {
      try {
        await ctx.cognitoIdSp
          .forgotPassword({
            Username: ctx.user.Username,
            ClientId: process.env.CLIENT_ID,
          })
          .promise();
      } catch (err) {
        // Log error and return successful response to the caller
        console.log(`Auth context: ${JSON.stringify(ctx)}`);
        console.error(err);
      }
    } else {
      if ((await completeSignUpFlow(ctx, Force.Reset)) === 'Success') {
        return badResponse({ code: 'ForceReset' });
      }
    }
  } else {
    if ((await completeSignUpFlow(ctx, Force.SignUp)) === 'Success') {
      return badResponse({ code: 'UserNotMigrated' });
    }
  }

  return defaultResponse;
};
