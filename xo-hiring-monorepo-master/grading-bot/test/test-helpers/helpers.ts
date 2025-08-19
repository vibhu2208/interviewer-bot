import { APIGatewayProxyEvent, Context } from 'aws-lambda';

export const SfQueryUrl = '/services/data/v57.0/query';

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

export function createTestEvent(overrides?: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  if (overrides && overrides.resource && overrides.pathParameters && !overrides.path) {
    // help generating path value
    overrides.path = overrides.resource;
    for (const key of Object.keys(overrides.pathParameters)) {
      const value = overrides.pathParameters[key] as string;
      overrides.path = overrides.path.replace(`{${key}}`, value);
    }
  }

  return {
    resource: '/grading/order',
    path: '/grading/order',
    httpMethod: 'POST',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      Host: 'grading-api-rest.crossover.com',
      Pragma: 'no-cache',
      SFDC_STACK_DEPTH: '1',
      'User-Agent': 'SFDC-Callout/58.0',
      'X-Amzn-Trace-Id': 'Root=1-650c370f-5d1ba63118e4c52e533faca8',
      'X-Forwarded-For': '101.53.164.8',
      'X-Forwarded-Port': '443',
      'X-Forwarded-Proto': 'https',
    },
    multiValueHeaders: {
      Accept: ['application/json'],
      'Cache-Control': ['no-cache'],
      'Content-Type': ['application/json'],
      Host: ['grading-api-rest.crossover.com'],
      Pragma: ['no-cache'],
      SFDC_STACK_DEPTH: ['1'],
      'User-Agent': ['SFDC-Callout/58.0'],
      'X-Amzn-Trace-Id': ['Root=1-650c370f-5d1ba63118e4c52e533faca8'],
      'X-Forwarded-For': ['101.53.164.8'],
      'X-Forwarded-Port': ['443'],
      'X-Forwarded-Proto': ['https'],
    },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      resourceId: 'wqahgq',
      resourcePath: '/grading/order',
      httpMethod: 'POST',
      extendedRequestId: 'Lm2KiGiSIAMEXcw=',
      requestTime: '21/Sep/2023:12:29:03 +0000',
      path: '/grading/order',
      accountId: '104042860393',
      protocol: 'HTTP/1.1',
      stage: 'production',
      domainPrefix: 'grading-api-rest',
      requestTimeEpoch: 1695299343933,
      requestId: 'edb3189e-6ddb-4ae9-b65e-2a0d8ee1d0b6',
      domainName: 'grading-api-rest.crossover.com',
      apiId: 'pvin4fra14',
      authorizer: null,
      identity: {
        cognitoIdentityPoolId: null,
        accountId: null,
        cognitoIdentityId: null,
        caller: null,
        sourceIp: '101.53.164.8',
        principalOrgId: null,
        accessKey: null,
        cognitoAuthenticationType: null,
        cognitoAuthenticationProvider: null,
        userArn: null,
        userAgent: 'SFDC-Callout/58.0',
        user: null,
        apiKey: null,
        apiKeyId: null,
        clientCert: null,
      },
    },
    body: null,
    isBase64Encoded: false,
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
