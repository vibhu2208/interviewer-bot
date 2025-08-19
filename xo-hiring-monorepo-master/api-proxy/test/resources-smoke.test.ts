import assert from 'assert';
import nock from 'nock';
import { handler } from '../src/handler';
import { SalesforceRest } from '../src/urls';
import { createTestContext, createTestEvent, setupEnv, teardownEnv, TestEnv, testName } from './helpers';

beforeAll(() => {
  nock.disableNetConnect();
});

afterAll(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

beforeEach(async () => {
  await setupEnv();
});

afterEach(async () => {
  await teardownEnv();
});

type PublicEndpointsTestData = {
  httpMethod: string;
  resource: string;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  usernameClaim?: string;
  payload?: unknown;
};

const testId = 'a0B1m000002DEoREAW';
const testId2 = '0061m000007xs2yAAA';

test.each<PublicEndpointsTestData>([
  {
    httpMethod: 'get',
    resource: '/assessments',
  },
  {
    httpMethod: 'get',
    resource: '/assessments',
    queryStringParameters: {
      categoryId: testId,
      domain: 'testdomain',
      pipelineIds: `${testId},${testId}`,
      type: 'type',
    },
  },
  {
    httpMethod: 'get',
    resource: '/googlejobs/getJobPostingSchema',
    queryStringParameters: {
      jobId: testId,
      jobIdType: 'Pipeline',
    },
  },
  {
    httpMethod: 'get',
    resource: '/googlejobs/topCellsInCity',
    queryStringParameters: {
      city: 'London',
      country: 'UK',
    },
  },
  {
    httpMethod: 'get',
    resource: '/googlejobs/topCities/{country}',
    pathParameters: { country: 'UK' },
  },
  {
    httpMethod: 'get',
    resource: '/googlejobs/topCountries',
  },
  {
    httpMethod: 'get',
    resource: '/googlejobs/topTitles',
    queryStringParameters: {
      pipelines: `${testId},${testId}`,
    },
  },
  {
    httpMethod: 'get',
    resource: '/jobBoardCell/{id}',
    pathParameters: {
      id: testId,
    },
  },
  {
    httpMethod: 'get',
    resource: '/maintenance-metadata',
    pathParameters: {},
  },
  {
    httpMethod: 'get',
    resource: '/picklist-values/{object}/{field}',
    pathParameters: {
      object: 'testobject',
      field: 'testfield',
    },
  },
  {
    httpMethod: 'get',
    resource: '/pipelines',
    queryStringParameters: {
      stakeholderId: testId,
      'product-code': '1234',
      status: 'Active',
    },
  },
  {
    httpMethod: 'get',
    resource: '/pipelines/{id}',
    pathParameters: {
      id: testId,
    },
  },
  {
    httpMethod: 'get',
    resource: '/pipelines/{id}',
    pathParameters: {
      id: '1234',
    },
  },
  {
    httpMethod: 'get',
    resource: '/record-types/{object-name}',
    pathParameters: {
      'object-name': 'testobject',
    },
  },
  {
    httpMethod: 'get',
    resource: '/roles/{id}',
    pathParameters: {
      id: testId,
    },
  },
  {
    httpMethod: 'get',
    resource: '/support-contact/{id}',
    pathParameters: {
      id: testId,
    },
  },
  {
    httpMethod: 'get',
    resource: '/ui-strings',
  },
  {
    httpMethod: 'post',
    resource: '/webhook/veriff/decision',
  },
  {
    httpMethod: 'post',
    resource: '/webhook/veriff/event',
  },
  {
    httpMethod: 'get',
    resource: '/candidates/{id}',
    pathParameters: {
      id: testId,
    },
    queryStringParameters: {
      xoManageId: testId,
    },
    usernameClaim: testId,
  },
  {
    httpMethod: 'patch',
    resource: '/candidates/{id}',
    pathParameters: {
      id: testId,
    },
    payload: {
      PersonMailingCountry: 'UK',
    },
    usernameClaim: testId,
  },
  {
    httpMethod: 'post',
    resource: '/candidates/{id}/apply',
    pathParameters: {
      id: testId,
    },
    usernameClaim: testId,
    payload: {
      inputs: [
        {
          iVarT_CandidateId: testId,
        },
      ],
    },
  },
])(testName('$#. $httpMethod $resource'), async (testData) => {
  const defaultReply = {
    done: true,
    totalSize: 0,
    records: [],
  };

  const matchPayload = (p: unknown) => {
    if (testData.payload) {
      assert.deepStrictEqual(p, testData.payload);
    }
    return true;
  };
  const url = TestEnv.baseUrl;
  const scope = (
    testData.httpMethod == 'get'
      ? nock(url)
          .get(() => true)
          .query(true)
      : testData.httpMethod == 'post'
      ? nock(url).post(() => true, matchPayload)
      : nock(url).patch(() => true, matchPayload)
  ).reply(200, defaultReply);

  const resp = await handler(
    createTestEvent(
      {
        ...testData,
        body: testData.payload ? JSON.stringify(testData.payload) : undefined,
      },
      testData.usernameClaim
        ? {
            authorizer: {
              claims: {
                username: testData.usernameClaim,
              },
            },
          }
        : undefined,
    ),
    createTestContext(),
  );

  assert.strictEqual(resp.statusCode, 200);
  assert.deepStrictEqual(JSON.parse(resp.body), defaultReply);
  assert.deepStrictEqual(resp.headers, { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' });

  scope.done();
});

const invalidId = 'a0B1m000002DEoREAW3';
const invalidType = '.';
const invalidCode = '123456';

test.each<PublicEndpointsTestData>([
  {
    httpMethod: 'get',
    resource: '/assessments',
    queryStringParameters: {
      categoryId: testId,
      domain: 'testdomain',
      pipelineIds: `${testId},${testId},${invalidId}`,
      type: 'type',
    },
  },
  {
    httpMethod: 'get',
    resource: '/googlejobs/getJobPostingSchema',
    queryStringParameters: {
      jobId: testId,
      jobIdType: 'InvalidValue',
    },
  },
  {
    httpMethod: 'get',
    resource: '/googlejobs/topCellsInCity',
    queryStringParameters: {
      country: 'UK',
      // missing city
    },
  },
  {
    httpMethod: 'get',
    resource: '/googlejobs/topTitles',
    queryStringParameters: {
      pipelines: `${testId},${invalidId}`,
    },
  },
  {
    httpMethod: 'get',
    resource: '/jobBoardCell/{id}',
    pathParameters: {
      id: invalidId,
    },
  },
  {
    httpMethod: 'get',
    resource: '/picklist-values/{object}/{field}',
    pathParameters: {
      object: 'testobject',
      field: invalidType,
    },
  },
  {
    httpMethod: 'get',
    resource: '/pipelines',
    queryStringParameters: {
      stakeholderId: testId,
      'product-code': invalidCode,
      status: 'Active',
    },
  },
  {
    httpMethod: 'get',
    resource: '/pipelines/{id}',
    pathParameters: {
      id: invalidId,
    },
  },
  {
    httpMethod: 'get',
    resource: '/pipelines/{id}',
    pathParameters: {
      id: invalidCode,
    },
  },
  {
    httpMethod: 'get',
    resource: '/record-types/{object-name}',
    pathParameters: {
      'object-name': invalidType,
    },
  },
  {
    httpMethod: 'get',
    resource: '/roles/{id}',
    pathParameters: {
      id: invalidId,
    },
  },
  {
    httpMethod: 'get',
    resource: '/support-contact/{id}',
    pathParameters: {
      id: invalidId,
    },
  },
])(testName('$#. $httpMethod $resource', 'invalid input', 'validation error'), async (testData) => {
  const resp = await handler(
    createTestEvent(
      {
        ...testData,
        body: testData.payload ? JSON.stringify(testData.payload) : undefined,
      },
      {
        authorizer: undefined,
      },
    ),
    createTestContext(),
  );

  assert.strictEqual(resp.statusCode, 400);
  const payload = JSON.parse(resp.body);
  assert.deepStrictEqual(payload?.errorCode, 'API_VALIDATION');
  assert.ok(payload?.message);
  assert.deepStrictEqual(resp.headers, { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' });
});

test.each<PublicEndpointsTestData & { failOwnershipCheck?: boolean }>([
  {
    httpMethod: 'get',
    resource: '/candidates/{id}/applications',
    pathParameters: {
      id: testId,
    },
    usernameClaim: testId2,
  },
  {
    httpMethod: 'post',
    resource: '/candidates/{id}/apply',
    pathParameters: {
      id: testId,
    },
    usernameClaim: testId,
    payload: {
      inputs: [
        {
          iVarT_CandidateId: testId2,
        },
      ],
    },
  },
  {
    httpMethod: 'patch',
    resource: '/candidates/{id}/assessment-results/{asrId}',
    pathParameters: {
      id: testId,
      asrId: testId2,
    },
    usernameClaim: testId,
    failOwnershipCheck: true,
    payload: {
      Badge_Hidden__c: true,
    },
  },
  {
    httpMethod: 'patch',
    resource: '/candidates/{id}/assessment-results/{asrId}',
    pathParameters: {
      id: testId,
      asrId: testId2,
    },
    usernameClaim: testId,
    failOwnershipCheck: false,
    payload: {
      UnknownProp: 1,
    },
  },
])(testName('$#. $httpMethod $resource', 'access to different candidate', 'forbidden'), async (testData) => {
  // ownership checks always fail
  let scope: nock.Scope | null = null;
  if (testData.failOwnershipCheck != undefined) {
    const sfReply = { done: true, totalSize: testData.failOwnershipCheck ? 0 : 1 };
    scope = nock(TestEnv.baseUrl).get(SalesforceRest.query).query(true).reply(200, sfReply);
  }

  const resp = await handler(
    createTestEvent(
      {
        ...testData,
        body: testData.payload ? JSON.stringify(testData.payload) : undefined,
      },
      testData.usernameClaim
        ? {
            authorizer: {
              claims: {
                username: testData.usernameClaim,
              },
            },
          }
        : undefined,
    ),
    createTestContext(),
  );

  assert.strictEqual(resp.statusCode, 403);
  const payload = JSON.parse(resp.body);
  assert.deepStrictEqual(payload?.errorCode, 'API_AUTHORIZATION');
  assert.ok(payload?.message);
  assert.deepStrictEqual(resp.headers, { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  scope?.done();
});
