import { AuthContext } from './auth-context';
import { getSfFlowUrl } from '../common/configHelper';
import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';

export enum Force {
  Reset = 1,
  SignUp = 2,
}

type CompleteSignUpFlowResult = 'CandidateNotFound' | 'ApiError' | 'FlowError' | 'Success';

export const completeSignUpFlow = async function (ctx: AuthContext, force?: number): Promise<CompleteSignUpFlowResult> {
  const sfFlowUrl = getSfFlowUrl(process.env.SF_URL, process.env.SF_API_VERSION, 'Complete_SignUp');

  try {
    const sfClient = await getSalesforceClient();
    const axiosResponse = await sfClient.post(
      `${sfFlowUrl}`,
      {
        inputs: [{ iVarT_Email: ctx.payload?.email, iVarN_Force: force }],
      },
      {
        headers: {
          Authorization: ctx.event.headers.Authorization,
        },
      },
    );
    console.log(`completeSignUpFlowResponse: ${JSON.stringify(axiosResponse.data)}`);

    if (axiosResponse.data[0]?.isSuccess === true) {
      if (axiosResponse.data[0]?.outputValues?.oVarB_Success === true) {
        return 'Success';
      } else {
        return 'CandidateNotFound';
      }
    } else {
      return 'FlowError';
    }
  } catch (err) {
    console.error(err);
    return 'ApiError';
  }
};
