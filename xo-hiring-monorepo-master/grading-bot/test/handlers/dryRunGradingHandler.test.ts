import { handler } from '../../src/handlers/dryRunGradingHandler';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { BatchWriteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createTestEvent, SfQueryUrl } from '../test-helpers/helpers';
import * as dryRunGradingRequest from '../test-data/dry-run-grading-request.json';
import * as gradingOrderResponseSfRules from '../test-data/grading-order-response-sf-rules.json';
import { setupSfClient, tearDownSfClient } from '../test-helpers/aws-sdk-v2-mocks';
import { TestEnv } from '../test-helpers/helpers';
import nock from 'nock';
import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from '@aws-sdk/client-athena';

const athenaMock = mockClient(AthenaClient);
const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

describe('dryRunGradingHandler', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  beforeEach(async () => {
    await setupSfClient();
    athenaMock.onAnyCommand().resolves({});
    ddbMock.onAnyCommand().resolves({});
    sqsMock.onAnyCommand().resolves({});

    process.env.DDB_TABLE_MAIN = 'main';
    process.env.TASKS_QUEUE_URL = 'q';
    process.env.ATHENA_OUTPUT_LOCATION = 'output';
    process.env.ATHENA_DB = 'db';
  });

  afterEach(async () => {
    await tearDownSfClient();
    athenaMock.reset();
    ddbMock.reset();
    sqsMock.reset();
    jest.clearAllMocks();
    process.env.DDB_TABLE_MAIN = undefined;
    process.env.TASKS_QUEUE_URL = undefined;
    process.env.ATHENA_OUTPUT_LOCATION = undefined;
    process.env.ATHENA_DB = undefined;
  });

  it('should return 500 status code when no data returned from Athena query', async () => {
    const sfScope = nock(TestEnv.baseUrl)
      .get(SfQueryUrl)
      .query(true)
      .reply(200, {
        done: true,
        totalSize: 0,
        records: [],
      })
      .get(SfQueryUrl)
      .query(true)
      .reply(200, gradingOrderResponseSfRules);

    athenaMock.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'test' });
    athenaMock.on(GetQueryExecutionCommand).resolves({ QueryExecution: { Status: { State: 'SUCCEEDED' } } });
    athenaMock.on(GetQueryResultsCommand).resolves({ ResultSet: { Rows: [] } });

    const res = await handler(
      createTestEvent({
        httpMethod: 'POST',
        resource: '/grading/dry-run',
        body: JSON.stringify(dryRunGradingRequest),
      }),
    );

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({
      success: false,
      error: 'Did not find enough tasks for application step a082j000000PigXAAS',
      feedback: [],
    });
    expect(ddbMock.calls().length).toBe(0);
    expect(sqsMock.calls().length).toBe(0);

    sfScope.done();
  });

  it('should return 201 status code and correctly handle Unstructured Google Doc grading mode', async () => {
    const sfScope = nock(TestEnv.baseUrl)
      .get(SfQueryUrl)
      .query(true)
      .reply(200, {
        totalSize: 1,
        done: true,
        records: [
          {
            attributes: {
              type: 'ApplicationStep__c',
              url: '/services/data/v58.0/sobjects/ApplicationStep__c/a082j000001v0kgAAA',
            },
            XO_Grading_Mode__c: 'Unstructured Google Doc',
          },
        ],
      })
      .get(SfQueryUrl)
      .query(true)
      .reply(200, gradingOrderResponseSfRules);

    athenaMock.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'test' });
    athenaMock.on(GetQueryExecutionCommand).resolves({ QueryExecution: { Status: { State: 'SUCCEEDED' } } });
    athenaMock.on(GetQueryResultsCommand).resolves({
      ResultSet: {
        ResultSetMetadata: {
          ColumnInfo: [
            { Name: 'applicationStepResultId', Type: 'varchar' },
            { Name: 'submissionTime', Type: 'varchar' },
            { Name: 'externalSubmissionTestId', Type: 'varchar' },
            { Name: 'smQuestionName', Type: 'varchar' },
            { Name: 'smResponseValue', Type: 'varchar' },
            { Name: 'smResponseId', Type: 'varchar' },
            { Name: 'smSurveyId', Type: 'varchar' },
            { Name: 'score', Type: 'varchar' },
            { Name: 'grader', Type: 'varchar' },
            { Name: 'applicationName', Type: 'varchar' },
          ],
        },
        Rows: [
          {
            Data: [
              { VarCharValue: 'applicationStepResultId' },
              { VarCharValue: 'submissionTime' },
              { VarCharValue: 'externalSubmissionTestId' },
              { VarCharValue: 'smQuestionName' },
              { VarCharValue: 'smResponseValue' },
              { VarCharValue: 'smResponseId' },
              { VarCharValue: 'smSurveyId' },
              { VarCharValue: 'score' },
              { VarCharValue: 'grader' },
              { VarCharValue: 'applicationName' },
            ],
          },
          {
            Data: [
              { VarCharValue: 'mockApplicationStepResultId1' },
              { VarCharValue: 'mockSubmissionTime1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockSmQuestionName1' },
              { VarCharValue: 'mockSmResponseValue1' },
              { VarCharValue: 'smResponseId1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockScore1' },
              { VarCharValue: 'mockGrader1' },
              { VarCharValue: 'mockApplicationName1' },
            ],
          },
          {
            Data: [
              { VarCharValue: 'mockApplicationStepResultId1' },
              { VarCharValue: 'mockSubmissionTime1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockSmQuestionName2' },
              { VarCharValue: 'https://docs.google.com/document/candidate-sumbission.pdf' },
              { VarCharValue: 'smResponseId1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockScore1' },
              { VarCharValue: 'mockGrader1' },
              { VarCharValue: 'mockApplicationName1' },
            ],
          },
          {
            Data: [
              { VarCharValue: 'mockApplicationStepResultId1' },
              { VarCharValue: 'mockSubmissionTime1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockSmQuestionName3' },
              { VarCharValue: 'mockSmResponseValue3' },
              { VarCharValue: 'smResponseId1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockScore1' },
              { VarCharValue: 'mockGrader1' },
              { VarCharValue: 'mockApplicationName1' },
            ],
          },
        ],
      },
    });

    const res = await handler(
      createTestEvent({
        httpMethod: 'POST',
        resource: '/grading/dry-run',
        body: JSON.stringify(dryRunGradingRequest),
      }),
    );

    expect(res.statusCode).toBe(201);
    const output = JSON.parse(res.body);
    delete output.gradingBatchId;
    expect(output).toEqual({
      success: true,
      message: 'Created 1 grading tasks',
      feedback: [],
    });

    expect(ddbMock).toHaveReceivedCommand(BatchWriteCommand);
    expect(ddbMock).toHaveReceivedCommandWith(BatchWriteCommand, {
      RequestItems: {
        main: [
          {
            PutRequest: {
              Item: {
                id: expect.any(String),
                pk: 'GRADING-BATCH',
                sk: expect.any(String),
                data: expect.objectContaining({
                  applicationStepId: 'a082j000000PigXAAS',
                  endDate: '2023-08-01',
                  notes: 'Some notes',
                  recipientEmail: 'artyom.melnikov@trilogy.com',
                  startDate: '2023-04-01',
                  default: expect.objectContaining({
                    applicationStepId: 'a082j000000PigXAAS',
                    endDate: '2023-08-01',
                    notes: 'Some notes',
                    recipientEmail: 'artyom.melnikov@trilogy.com',
                    startDate: '2023-04-01',
                  }),
                }),
                tasksCompleted: 0,
                tasksCount: 1,
              },
            },
          },
          {
            PutRequest: {
              Item: {
                id: expect.any(String),
                pk: 'GRADING-TASK',
                sk: expect.any(String),
                applicationStepId: 'a082j000000PigXAAS',
                applicationStepResultId: 'mockApplicationStepResultId1',
                data: expect.objectContaining({
                  applicationName: 'mockApplicationName1',
                  grader: 'mockGrader1',
                  score: 'mockScore1',
                  submissionTime: 'mockSubmissionTime1',
                }),
                gradingBatchId: expect.any(String),
                gradingMode: 'Unstructured Google Doc',
                rules: [
                  expect.objectContaining({ id: expect.any(String), name: 'Choose an example correctly' }),
                  expect.objectContaining({ id: expect.any(String), name: 'Did they clearly define hard work' }),
                ],
                status: 'Pending',
                submission: undefined,
                submissionLink: 'https://docs.google.com/document/candidate-sumbission.pdf',
              },
            },
          },
        ],
      },
    });

    expect(sqsMock).toHaveReceivedCommand(SendMessageBatchCommand);

    sfScope.done();
  });

  it('should return 201 status code and correctly handle SM Response grading mode', async () => {
    const sfScope = nock(TestEnv.baseUrl)
      .get(SfQueryUrl)
      .query(true)
      .reply(200, {
        totalSize: 1,
        done: true,
        records: [
          {
            attributes: {
              type: 'ApplicationStep__c',
              url: '/services/data/v58.0/sobjects/ApplicationStep__c/a082j000001v0kgAAA',
            },
            XO_Grading_Mode__c: 'SM Response',
          },
        ],
      })
      .get(SfQueryUrl)
      .query(true)
      .reply(200, gradingOrderResponseSfRules);

    athenaMock.on(StartQueryExecutionCommand).resolves({ QueryExecutionId: 'test' });
    athenaMock.on(GetQueryExecutionCommand).resolves({ QueryExecution: { Status: { State: 'SUCCEEDED' } } });
    athenaMock.on(GetQueryResultsCommand).resolves({
      ResultSet: {
        ResultSetMetadata: {
          ColumnInfo: [
            { Name: 'applicationStepResultId', Type: 'varchar' },
            { Name: 'submissionTime', Type: 'varchar' },
            { Name: 'externalSubmissionTestId', Type: 'varchar' },
            { Name: 'smQuestionName', Type: 'varchar' },
            { Name: 'smResponseValue', Type: 'varchar' },
            { Name: 'smResponseId', Type: 'varchar' },
            { Name: 'smSurveyId', Type: 'varchar' },
            { Name: 'score', Type: 'varchar' },
            { Name: 'grader', Type: 'varchar' },
            { Name: 'applicationName', Type: 'varchar' },
          ],
        },
        Rows: [
          {
            Data: [
              { VarCharValue: 'applicationStepResultId' },
              { VarCharValue: 'submissionTime' },
              { VarCharValue: 'externalSubmissionTestId' },
              { VarCharValue: 'smQuestionName' },
              { VarCharValue: 'smResponseValue' },
              { VarCharValue: 'smResponseId' },
              { VarCharValue: 'smSurveyId' },
              { VarCharValue: 'score' },
              { VarCharValue: 'grader' },
              { VarCharValue: 'applicationName' },
            ],
          },
          {
            Data: [
              { VarCharValue: 'mockApplicationStepResultId1' },
              { VarCharValue: 'mockSubmissionTime1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockSmQuestionName2' },
              { VarCharValue: 'mockSmResponseValue2' },
              { VarCharValue: 'smResponseId0' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockScore1' },
              { VarCharValue: 'mockGrader1' },
              { VarCharValue: 'mockApplicationName1' },
            ],
          },
          {
            Data: [
              { VarCharValue: 'mockApplicationStepResultId1' },
              { VarCharValue: 'mockSubmissionTime1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockSmQuestionName1' },
              { VarCharValue: 'mockSmResponseValue1' },
              { VarCharValue: 'smResponseId1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockScore1' },
              { VarCharValue: 'mockGrader1' },
              { VarCharValue: 'mockApplicationName1' },
            ],
          },
          {
            Data: [
              { VarCharValue: 'mockApplicationStepResultId1' },
              { VarCharValue: 'mockSubmissionTime1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockSmQuestionName2' },
              { VarCharValue: 'mockSmResponseValue2' },
              { VarCharValue: 'smResponseId1' },
              { VarCharValue: 'mockSmSurveyId1' },
              { VarCharValue: 'mockScore1' },
              { VarCharValue: 'mockGrader1' },
              { VarCharValue: 'mockApplicationName1' },
            ],
          },
        ],
      },
    });

    const res = await handler(
      createTestEvent({
        httpMethod: 'POST',
        resource: '/grading/dry-run',
        body: JSON.stringify(dryRunGradingRequest),
      }),
    );

    expect(res.statusCode).toBe(201);
    const output = JSON.parse(res.body);
    delete output.gradingBatchId;
    expect(output).toEqual({
      success: true,
      message: 'Created 1 grading tasks',
      feedback: [],
    });

    expect(ddbMock).toHaveReceivedCommand(BatchWriteCommand);
    expect(ddbMock).toHaveReceivedCommandWith(BatchWriteCommand, {
      RequestItems: {
        main: [
          {
            PutRequest: {
              Item: {
                id: expect.any(String),
                pk: 'GRADING-BATCH',
                sk: expect.any(String),
                data: expect.objectContaining({
                  applicationStepId: 'a082j000000PigXAAS',
                  endDate: '2023-08-01',
                  notes: 'Some notes',
                  recipientEmail: 'artyom.melnikov@trilogy.com',
                  startDate: '2023-04-01',
                  default: expect.objectContaining({
                    applicationStepId: 'a082j000000PigXAAS',
                    endDate: '2023-08-01',
                    notes: 'Some notes',
                    recipientEmail: 'artyom.melnikov@trilogy.com',
                    startDate: '2023-04-01',
                  }),
                }),
                tasksCompleted: 0,
                tasksCount: 1,
              },
            },
          },
          {
            PutRequest: {
              Item: {
                id: expect.any(String),
                pk: 'GRADING-TASK',
                sk: expect.any(String),
                applicationStepId: 'a082j000000PigXAAS',
                applicationStepResultId: 'mockApplicationStepResultId1',
                data: expect.objectContaining({
                  applicationName: 'mockApplicationName1',
                  grader: 'mockGrader1',
                  score: 'mockScore1',
                  submissionTime: 'mockSubmissionTime1',
                }),
                gradingBatchId: expect.any(String),
                gradingMode: 'SM Response',
                rules: [
                  expect.objectContaining({ id: expect.any(String), name: 'Choose an example correctly' }),
                  expect.objectContaining({ id: expect.any(String), name: 'Did they clearly define hard work' }),
                ],
                status: 'Pending',
                submission: [
                  expect.objectContaining({ question: 'mockSmQuestionName1', answer: 'mockSmResponseValue1' }),
                  expect.objectContaining({ question: 'mockSmQuestionName2', answer: 'mockSmResponseValue2' }),
                ],
                submissionLink: undefined,
              },
            },
          },
        ],
      },
    });

    expect(sqsMock).toHaveReceivedCommand(SendMessageBatchCommand);

    sfScope.done();
  });
});
