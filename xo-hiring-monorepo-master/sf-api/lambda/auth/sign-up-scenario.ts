import { AuthContext } from './auth-context';
import { APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { badResponse } from './common';
import { initiateAuth } from './sign-in-scenario';

export const signUp = async function (ctx: AuthContext): Promise<APIGatewayProxyResult> {
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

  return await initiateAuth(ctx, {
    AuthParameters: {
      USERNAME: ctx.payload?.email,
      PASSWORD: ctx.payload?.password,
    },
    ClientMetadata: {
      id: ctx.payload?.id,
    },
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: process.env.CLIENT_ID,
  });
};
