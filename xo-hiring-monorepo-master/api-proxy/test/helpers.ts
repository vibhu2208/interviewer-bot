import {
  APIGatewayEventDefaultAuthorizerContext,
  APIGatewayEventRequestContextWithAuthorizer,
  APIGatewayProxyCognitoAuthorizer,
  APIGatewayProxyEvent,
  APIGatewayProxyWithCognitoAuthorizerEvent,
  Context,
} from 'aws-lambda';
import AWSMock from 'aws-sdk-mock';

export function testName(endpoint: string, conditions?: string, result?: string) {
  return `${endpoint}${conditions ? `-${conditions}` : ''}-${result || 'OK'}`;
}

export function createTestEvent(
  overrides?: Partial<APIGatewayProxyWithCognitoAuthorizerEvent | APIGatewayProxyEvent>,
  requestContextOverrides?: Partial<
    | APIGatewayEventRequestContextWithAuthorizer<APIGatewayProxyCognitoAuthorizer>
    | APIGatewayEventRequestContextWithAuthorizer<APIGatewayEventDefaultAuthorizerContext>
  >,
): APIGatewayProxyWithCognitoAuthorizerEvent | APIGatewayProxyEvent {
  if (overrides && overrides.resource && overrides.pathParameters && !overrides.path) {
    // help generating path value
    overrides.path = overrides.resource;
    for (const key of Object.keys(overrides.pathParameters)) {
      const value = overrides.pathParameters[key] as string;
      overrides.path = overrides.path.replace(`{${key}}`, value);
    }
  }

  return {
    body: null,
    headers: {
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      Host: 'tmmza39x9f.execute-api.us-east-1.amazonaws.com',
      'User-Agent': 'PostmanRuntime/7.29.2',
      'X-Amzn-Trace-Id': 'Root=1-6385fc8f-266677484c0a880f4be85d12',
      'X-Forwarded-For': '93.184.216.34',
      'X-Forwarded-Port': '443',
      'X-Forwarded-Proto': 'https',
    },
    multiValueHeaders: {
      Accept: ['*/*'],
      'Accept-Encoding': ['gzip, deflate, br'],
      Host: ['tmmza39x9f.execute-api.us-east-1.amazonaws.com'],
      'User-Agent': ['PostmanRuntime/7.29.2'],
      'X-Amzn-Trace-Id': ['Root=1-6385fc8f-266677484c0a880f4be85d12'],
      'X-Forwarded-For': ['93.184.216.34'],
      'X-Forwarded-Port': ['443'],
      'X-Forwarded-Proto': ['https'],
    },
    httpMethod: 'get',
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '/',
    requestContext: {
      authorizer: {
        claims: {},
      },
      resourceId: '1mawnv',
      resourcePath: '/maintenance-metadata',
      httpMethod: 'GET',
      extendedRequestId: 'cXRmfEh7oAMFU_g=',
      requestTime: '29/Nov/2022:12:35:27 +0000',
      path: '/pr182/maintenance-metadata',
      accountId: '104042860393',
      protocol: 'HTTP/1.1',
      stage: 'pr182',
      domainPrefix: 'tmmza39x9f',
      requestTimeEpoch: 1669725327784,
      requestId: '79651f00-e1da-458f-85ae-f46b0bb91865',
      identity: {
        apiKey: null,
        apiKeyId: null,
        clientCert: null,
        cognitoIdentityPoolId: null,
        accountId: null,
        cognitoIdentityId: null,
        caller: null,
        sourceIp: '93.184.216.34',
        principalOrgId: null,
        accessKey: null,
        cognitoAuthenticationType: null,
        cognitoAuthenticationProvider: null,
        userArn: null,
        userAgent: 'PostmanRuntime/7.29.2',
        user: null,
      },
      domainName: 'tmmza39x9f.execute-api.us-east-1.amazonaws.com',
      apiId: 'tmmza39x9f',
      ...requestContextOverrides,
    },
    ...overrides,
  };
}

export function createTestContext(overrides?: Partial<Context>): Context {
  const notImplemented = () => {
    throw new Error('Not implemented.');
  };
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'api-proxy',
    functionVersion: '1',
    invokedFunctionArn: '',
    memoryLimitInMB: '128',
    awsRequestId: '',
    logGroupName: '',
    logStreamName: '',
    getRemainingTimeInMillis: notImplemented,
    done: notImplemented,
    fail: notImplemented,
    succeed: notImplemented,
    ...overrides,
  };
}

export const TestEnv = {
  name: 'production',
  baseUrl: 'https://example.com',
  documentUrl: 'https://example.com',
  credentials: {
    client_id: 'test_client_id',
    client_secret: 'test_client_secret',
    username: 'test_user',
    password: 'test_password',
  },
};

const ssmParameters = new Map<string, string>();

export async function setupEnv() {
  // SSM
  ssmParameters.set('/xo-hiring/production/common/salesforce-app-account', JSON.stringify(TestEnv));
  ssmParameters.set(
    '/xo-hiring/production/salesforceAuthorizer/access_token',
    JSON.stringify([
      {
        user: 'test_user',
        token: 'test_access_token',
      },
    ]),
  );
  AWSMock.mock('SSM', 'getParameter', (req, callback) => {
    callback(undefined, { Parameter: { Value: ssmParameters.get(req.Name) } });
  });
  AWSMock.mock('SSM', 'putParameter', (req, callback) => {
    ssmParameters.set(req.Name, req.Value);
    callback(undefined, {});
  });

  // ENV
  process.env.ENV = 'production';
  process.env.FULLACCESS_GROUP_NAMES = 'admin';
  process.env.READONLY_GROUP_NAMES = 'hm';
}

export async function teardownEnv() {
  AWSMock.restore('SSM');
  ssmParameters.clear();
  process.env.ENV = undefined;
  process.env.FULLACCESS_GROUP_NAMES = undefined;
  process.env.READONLY_GROUP_NAMES = undefined;
}
