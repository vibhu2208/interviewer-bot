import { handler } from '../../src/handlers/orderGradingHandler';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createTestEvent, SfQueryUrl } from '../test-helpers/helpers';
import * as gradingOrderRequestWithRules from '../test-data/grading-order-request-with-rules.json';
import * as gradingOrderRequestNoRules from '../test-data/grading-order-request-no-rules.json';
import * as gradingOrderResponseSfRules from '../test-data/grading-order-response-sf-rules.json';
import { setupSfClient, tearDownSfClient } from '../test-helpers/aws-sdk-v2-mocks';
import { TestEnv } from '../test-helpers/helpers';
import nock from 'nock';

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

describe('orderGradingHandler', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    await setupSfClient();
    ddbMock.onAnyCommand().resolves({});
    sqsMock.onAnyCommand().resolves({});

    process.env.DDB_TABLE_MAIN = 'main';
    process.env.TASKS_QUEUE_URL = 'q';
  });

  afterEach(async () => {
    await tearDownSfClient();
    ddbMock.reset();
    sqsMock.reset();
    jest.clearAllMocks();
    process.env.DDB_TABLE_MAIN = undefined;
    process.env.TASKS_QUEUE_URL = undefined;
  });

  it('should return 500 status code when there are no tasks in payload', async () => {
    const res = await handler(
      createTestEvent({
        httpMethod: 'POST',
        resource: '/grading/order',
      }),
    );

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ success: false, error: 'No tasks provided as an input' });
    expect(ddbMock.calls().length).toBe(0);
    expect(sqsMock.calls().length).toBe(0);
  });

  it('should return 500 status code when there are no rules in payload and SF response', async () => {
    const sfScope = nock(TestEnv.baseUrl).get(SfQueryUrl).query(true).reply(200, {
      done: true,
      totalSize: 0,
      records: [],
    });

    const res = await handler(
      createTestEvent({
        httpMethod: 'POST',
        resource: '/grading/order',
        body: JSON.stringify(gradingOrderRequestNoRules),
      }),
    );

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ success: false, error: 'No grading rules found for the tasks' });
    expect(ddbMock.calls().length).toBe(0);
    expect(sqsMock.calls().length).toBe(0);

    sfScope.done();
  });

  it('should call SF when there are no rules in payload', async () => {
    const sfScope = nock(TestEnv.baseUrl).get(SfQueryUrl).query(true).reply(200, gradingOrderResponseSfRules);

    const res = await handler(
      createTestEvent({
        httpMethod: 'POST',
        resource: '/grading/order',
        body: JSON.stringify(gradingOrderRequestNoRules),
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(ddbMock).toHaveReceivedCommand(BatchWriteCommand);
    expect(sqsMock).toHaveReceivedCommand(SendMessageBatchCommand);

    sfScope.done();
  });

  it('should return 201 status code for valid request', async () => {
    const res = await handler(
      createTestEvent({
        httpMethod: 'POST',
        resource: '/grading/order',
        body: JSON.stringify(gradingOrderRequestWithRules),
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(ddbMock).toHaveReceivedCommand(BatchWriteCommand);
    expect(sqsMock).toHaveReceivedCommand(SendMessageBatchCommand);
  });
});
