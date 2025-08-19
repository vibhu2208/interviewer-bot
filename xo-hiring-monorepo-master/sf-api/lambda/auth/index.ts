import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { AuthContext } from './auth-context';
import { badResponse, errorResponse } from './common';
import { sendVerificationCode } from './send-verification-code-scenario';
import { verifyEmail } from './verify-email-scenario';
import { signIn } from './sign-in-scenario';
import { signUp } from './sign-up-scenario';
import { sendResetPasswordCode } from './send-reset-password-code-scenario';
import { resetPassword } from './reset-password-scenario';
import { completeSignUp } from './complete-sign-up-scenario';
import { forceResetPassword } from './force-reset-password-scenario';

exports.handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let response: APIGatewayProxyResult;

  try {
    const authContext = new AuthContext(event);

    switch (authContext.scenario) {
      case 'SendVerificationCode':
        response = await sendVerificationCode(authContext);
        break;

      case 'VerifyEmail':
        response = await verifyEmail(authContext);
        break;

      case 'SignIn':
        response = await signIn(authContext);
        break;

      case 'SignUp':
        response = await signUp(authContext);
        break;

      case 'SendResetPasswordCode':
        response = await sendResetPasswordCode(authContext);
        break;

      case 'ResetPassword':
        response = await resetPassword(authContext);
        break;

      case 'ForceResetPassword':
        response = await forceResetPassword(authContext);
        break;

      case 'CompleteSignUp':
        response = await completeSignUp(authContext);
        break;

      default:
        response = badResponse({
          code: 'NotRecognizedScenario',
          message: `'${authContext.scenario}' is not a recognized scenario`,
        });
        break;
    }
  } catch (err) {
    // Log any unhandled error, and return InternalServerError to the caller
    console.log(`Auth lambda is triggered with event: ${JSON.stringify(event)}`);
    console.error(err);
    response = errorResponse({ code: 'InternalServerError' }, 500);
  }

  return response;
};
