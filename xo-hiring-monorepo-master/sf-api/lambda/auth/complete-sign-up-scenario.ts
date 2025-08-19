import { AuthContext } from './auth-context';
import { APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { defaultResponse } from './common';
import { completeSignUpFlow } from './sf-utils';

export const completeSignUp = async function (ctx: AuthContext): Promise<APIGatewayProxyResult> {
  await completeSignUpFlow(ctx);

  // Always return successful response
  return defaultResponse;
};
