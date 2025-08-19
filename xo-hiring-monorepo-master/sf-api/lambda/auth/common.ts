import { APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';

export type AuthScenario =
  | 'SignIn'
  | 'SignUp'
  | 'SendVerificationCode'
  | 'VerifyEmail'
  | 'SendResetPasswordCode'
  | 'ResetPassword'
  | 'ForceResetPassword'
  | 'CompleteSignUp';

export interface RequestBody {
  scenario: AuthScenario;
  email: string;
  password: string;
  code?: string;
  id?: string;
}

interface ErrorMessage {
  code: string;
  message?: string;
}

export const defaultResponse: APIGatewayProxyResult = {
  statusCode: 200,
  headers: {
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify({ result: 'success' }),
};

export const badResponse = function (error: ErrorMessage): APIGatewayProxyResult {
  return errorResponse(error, 400);
};

export const unAuthorizedResponse = function (error: ErrorMessage): APIGatewayProxyResult {
  return errorResponse(error, 401);
};

export const errorResponse = function (error: ErrorMessage, statusCode: number): APIGatewayProxyResult {
  return {
    ...defaultResponse,
    statusCode: statusCode,
    body: JSON.stringify(error),
  };
};
