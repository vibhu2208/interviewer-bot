import * as AWS from 'aws-sdk';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda/trigger/api-gateway-proxy';
import { getSfQueryUrl } from '../common/configHelper';
import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';

const sfQueryUrl = getSfQueryUrl(process.env.SF_URL, process.env.SF_API_VERSION);

exports.handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let result: boolean;
  try {
    const sfClient = await getSalesforceClient();
    const query = `SELECT COUNT()
                       FROM Account
                       WHERE PersonEmail = '${event.pathParameters.email}'
                         AND Last_Successful_Login__c = NULL`;

    const axiosResponse = await sfClient.get(`${sfQueryUrl}/?q=${encodeURIComponent(query)}`);

    result = axiosResponse.data.totalSize !== 0;
  } catch (e) {
    console.error(e);
    result = false;
  }
  if (result) {
    // Candidate found in SalesForce and ready to migrate. Now check if user exists in Cognito
    const cognitoIdSp = new AWS.CognitoIdentityServiceProvider();
    const filter = 'email="' + event.pathParameters.email + '"';
    const params = {
      UserPoolId: process.env.USER_POOL_ID,
      AttributesToGet: [],
      Filter: filter,
    };
    try {
      const data = await cognitoIdSp.listUsers(params).promise();
      if (data.Users.length == 0) {
        result = true;
      } else {
        result = false;
      }
    } catch (e) {
      console.error(e);
      result = false;
    }
  }
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ requireFinalizeSignUp: result }),
  };
};
