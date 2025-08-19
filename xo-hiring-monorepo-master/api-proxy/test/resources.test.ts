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

test(testName('get /maintenance-metadata'), async () => {
  const sfReply = { done: true };
  const scope = nock(TestEnv.baseUrl)
    .get(SalesforceRest.query)
    .query(true)
    .reply(200, sfReply, { 'salesforce-custom-header': 'value' });

  const resp = await handler(
    createTestEvent({ httpMethod: 'get', resource: '/maintenance-metadata' }),
    createTestContext(),
  );

  assert.strictEqual(resp.statusCode, 200);
  assert.deepStrictEqual(resp.body, JSON.stringify(sfReply));
  assert.deepStrictEqual(resp.headers, { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' });

  scope.done();
});

test(testName('get /candidates/{id}/assessment-results/{asrId}/responses'), async () => {
  const candidateId = '0011m00000cxpTXAAY';
  const asrId = 'a0B1m000002DEoREAW';
  const sfReply = {
    done: true,
    totalSize: 1,
    records: [
      {
        Application_Step_Result__r: {
          Candidate__c: '0011m00000cxpTXAAY',
        },
      },
    ],
  };
  const scope = nock(TestEnv.baseUrl).get(SalesforceRest.query).query(true).reply(200, sfReply);

  const resp = await handler(
    createTestEvent(
      {
        httpMethod: 'get',
        resource: '/candidates/{id}/assessment-results/{asrId}/responses',
        pathParameters: {
          id: candidateId,
          asrId: asrId,
        },
      },
      {
        authorizer: {
          claims: {
            username: candidateId,
          },
        },
      },
    ),
    createTestContext(),
  );

  assert.strictEqual(resp.statusCode, 200);
  assert.deepStrictEqual(resp.body, JSON.stringify(sfReply));
  assert.deepStrictEqual(resp.headers, { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' });

  scope.done();
});

test(
  testName('get /candidates/{id}/assessment-results/{asrId}/responses', 'invalid candidate id', 'Forbidden'),
  async () => {
    const candidateId = '0011m00000cxpTXAAY';
    const returnedCandidateId = '0011m00000cxpTXAAX';
    const asrId = 'a0B1m000002DEoREAW';
    const sfReply = {
      done: true,
      totalSize: 1,
      records: [
        {
          Application_Step_Result__r: {
            Candidate__c: returnedCandidateId,
          },
        },
      ],
    };
    const scope = nock(TestEnv.baseUrl).get(SalesforceRest.query).query(true).reply(200, sfReply);

    const resp = await handler(
      createTestEvent(
        {
          httpMethod: 'get',
          resource: '/candidates/{id}/assessment-results/{asrId}/responses',
          pathParameters: {
            id: candidateId,
            asrId: asrId,
          },
        },
        {
          authorizer: {
            claims: {
              username: candidateId,
            },
          },
        },
      ),
      createTestContext(),
    );

    assert.strictEqual(resp.statusCode, 403);
    assert.deepStrictEqual(JSON.parse(resp.body), { message: 'Access denied.', errorCode: 'API_AUTHORIZATION' });
    assert.deepStrictEqual(resp.headers, { 'content-type': 'application/json', 'Access-Control-Allow-Origin': '*' });

    scope.done();
  },
);
