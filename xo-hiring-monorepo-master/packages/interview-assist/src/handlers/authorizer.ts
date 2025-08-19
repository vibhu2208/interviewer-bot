import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';
import { APIGatewayAuthorizerResult, APIGatewayTokenAuthorizerEvent } from 'aws-lambda';
import axios from 'axios';

const log = defaultLogger({ serviceName: 'authorizer' });

export type SfAuthorizerContext = { userGroups: string };

export const handler = async (event: APIGatewayTokenAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
  const token = event.authorizationToken;

  log.info('Authorizing token', { token });

  try {
    const isAuthorized = await validateToken(token);

    log.info('Token is authorized', { isAuthorized });

    const context: SfAuthorizerContext = {
      userGroups: 'admin,hm',
    };

    const response: APIGatewayAuthorizerResult = {
      principalId: 'user',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: isAuthorized ? 'Allow' : 'Deny',
            Resource: getResourceArn(event),
          },
        ],
      },
      context,
    };

    log.info('Authorizer response', { response });

    return response;
  } catch (error) {
    log.error('Authorization failed', { error });

    throw new Error('Unauthorized');
  }
};

async function validateToken(token: string): Promise<boolean> {
  const sf = await Salesforce.getAdminClient();

  log.info('Validating token', { token });
  log.info('Base URL', { baseUrl: sf.restApi().defaults.baseURL });

  try {
    const response = await axios.request({
      method: 'GET',
      url: `${sf.restApi().defaults.baseURL}/services/oauth2/userinfo`,
      headers: {
        Authorization: token,
      },
    });

    log.info('User info', { userInfo: response.data });

    return response.data.user_id !== null;
  } catch (error) {
    log.error('Error validating token', { error });
    return false;
  }
}

function getResourceArn(event: APIGatewayTokenAuthorizerEvent) {
  // Generate a more generic resource ARN for the API Gateway
  // We cannot use the methodArn as it is cached and may get reused for different requests
  const methodArnParts = event.methodArn.split(':');
  const apiGatewayArnParts = methodArnParts[5].split('/');
  const awsAccountId = methodArnParts[4];
  const region = methodArnParts[3];
  const restApiId = apiGatewayArnParts[0];
  const stage = apiGatewayArnParts[1];

  // Create wildcard resource ARN that allows access to all methods
  const resourceArn = `arn:aws:execute-api:${region}:${awsAccountId}:${restApiId}/${stage}/*/*`;
  return resourceArn;
}
