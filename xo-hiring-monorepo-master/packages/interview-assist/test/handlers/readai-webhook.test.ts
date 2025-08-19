import { APIGatewayProxyEvent } from 'aws-lambda';
import { handleReadAiWebhook } from '../../src/handlers/readai-webhook';
import { Salesforce } from '@trilogy-group/xoh-integration';
import { Sqs } from '../../src/integrations/sqs';
import { ReadAiTranscript } from '../../src/models/read-ai-transcript';

// Mock dependencies
jest.mock('@trilogy-group/xoh-integration', () => {
  const originalModule = jest.requireActual('@trilogy-group/xoh-integration');
  return {
    Salesforce: {
      getAdminClient: jest.fn(),
      silent: jest.fn(),
    },
    defaultLogger: originalModule.defaultLogger,
  };
});

jest.mock('../../src/models/read-ai-transcript', () => ({
  ReadAiTranscript: {
    insertNew: jest.fn(),
    insertNewWithId: jest.fn(),
    getById: jest.fn(),
  },
}));
jest.mock('../../src/integrations/sqs', () => ({
  Sqs: {
    sendTask: jest.fn(),
  },
}));

describe('handleReadAiWebhook', () => {
  const mockSalesforceClient = {
    querySOQL: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    (Salesforce.getAdminClient as jest.Mock).mockResolvedValue(mockSalesforceClient);
  });

  it('should successfully process a webhook event and save transcript', async () => {
    // Prepare mock data matching the sample CSV
    const mockEvents = [
      {
        EventStartTime__c: '2024-12-15T16:30:00.000Z',
        ObjectId__c: 'a0BIj000001rIInMAX',
        EventPrimaryPublisherEmail__c: 'test@crossover.com',
        InviteeEmail__c: 'test@candidate.com',
        Name: 'invitee.canceled',
        EventUuid__c: '31c1a62d-b8c4-4475-871d-4486f94edb7c',
      },
      {
        EventStartTime__c: '2024-12-15T16:30:00.000Z',
        ObjectId__c: 'a0BIj000001rIInMAX',
        EventPrimaryPublisherEmail__c: 'test@crossover.com',
        InviteeEmail__c: 'test@candidate.com',
        Name: 'invitee.created',
        EventUuid__c: '31c1a62d-b8c4-4475-871d-4486f94edb7c',
      },
      {
        EventStartTime__c: '2024-12-14T16:30:00.000Z',
        ObjectId__c: 'a0BIj000001rIInMAM',
        EventPrimaryPublisherEmail__c: 'test@crossover.com',
        InviteeEmail__c: 'test@candidate.com',
        Name: 'invitee.created',
        EventUuid__c: '66c1a62d-b8c4-4475-871d-4486f94edb7c',
      },
    ];

    // Mock Salesforce query to return the events
    mockSalesforceClient.querySOQL.mockResolvedValue(mockEvents);

    // Create a mock webhook payload
    const mockEvent: APIGatewayProxyEvent = {
      body: JSON.stringify({
        owner: { email: 'test@crossover.com' },
        participants: [{ email: 'test@candidate.com' }],
        start_time: '2024-12-14T16:30:00.000Z',
      }),
    } as APIGatewayProxyEvent;

    // Call the handler
    const result = await handleReadAiWebhook(mockEvent);

    // Assertions
    expect(result.statusCode).toBe(200);
    expect(Salesforce.getAdminClient).toHaveBeenCalled();
    expect(mockSalesforceClient.querySOQL).toHaveBeenCalled();
    expect(ReadAiTranscript.insertNew).toHaveBeenCalledWith(
      expect.objectContaining({
        asrId: 'a0BIj000001rIInMAM',
        payload: {
          owner: { email: 'test@crossover.com' },
          participants: [{ email: 'test@candidate.com' }],
          start_time: '2024-12-14T16:30:00.000Z',
        },
      }),
    );
    expect(Sqs.sendTask).toHaveBeenCalledWith({
      type: 'generate-summary',
      transcriptId: 'a0BIj000001rIInMAM',
    });
  });

  it('should handle events with no matching interview ASR', async () => {
    // Mock empty events array
    mockSalesforceClient.querySOQL.mockResolvedValue([]);

    const mockEvent: APIGatewayProxyEvent = {
      body: JSON.stringify({
        owner: { email: 'test@crossover.com' },
        participants: [{ email: 'test@candidate.com' }],
        start_time: '2024-12-14T16:30:00.000Z',
      }),
    } as APIGatewayProxyEvent;

    const result = await handleReadAiWebhook(mockEvent);

    expect(result.statusCode).toBe(200);
    expect(ReadAiTranscript.insertNew).not.toHaveBeenCalled();
    expect(Sqs.sendTask).not.toHaveBeenCalled();
  });

  it('should find matching ASR by grader ID and event start time', async () => {
    // Mock ASR records that would be returned for the grader
    const mockAsrRecords = [
      {
        Id: 'a0BIj0000029lijMAA',
        Scheduled_For_Time__c: null,
        Started_At_Time__c: null,
        ApplicationId__r: { Account: { PersonEmail: 'candidate@example.com' } },
      },
      {
        Id: 'a0BIj0000029lijMAB',
        Scheduled_For_Time__c: '2025-01-22T13:00:00.000Z',
        Started_At_Time__c: '2025-01-21T17:30:16.000Z',
        ApplicationId__r: { Account: { PersonEmail: 'candidate@example.com' } },
      },
      {
        Id: 'a0BIj0000029lijMAC',
        Scheduled_For_Time__c: '2024-12-01T13:00:00.000Z',
        Started_At_Time__c: '2024-12-01T15:30:16.000Z',
        ApplicationId__r: { Account: { PersonEmail: 'candidate@example.com' } },
      },
    ];

    // Mock Salesforce query to return the ASR records
    mockSalesforceClient.querySOQL.mockResolvedValue(mockAsrRecords);

    // Create a mock webhook payload with matching start time
    const mockEvent: APIGatewayProxyEvent = {
      pathParameters: {
        graderId: '005Ij000000SHNEIA4',
      },
      body: JSON.stringify({
        owner: { email: 'interviewer@crossover.com' },
        participants: [{ email: 'candidate@example.com' }],
        start_time: '2025-01-22T15:00:00',
      }),
    } as any as APIGatewayProxyEvent;

    // Call the handler
    const result = await handleReadAiWebhook(mockEvent);

    // Assertions
    expect(result.statusCode).toBe(200);
    expect(Salesforce.getAdminClient).toHaveBeenCalled();
    expect(mockSalesforceClient.querySOQL).toHaveBeenCalledWith(
      expect.stringContaining('SELECT Id, Scheduled_For_Time__c, Started_At_Time__c'),
    );
    expect(ReadAiTranscript.insertNew).toHaveBeenCalledWith(
      expect.objectContaining({
        asrId: 'a0BIj0000029lijMAB',
        payload: expect.objectContaining({
          start_time: '2025-01-22T15:00:00',
        }),
      }),
    );
    expect(Sqs.sendTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'generate-summary',
        transcriptId: 'a0BIj0000029lijMAB',
      }),
    );
    expect(Sqs.sendTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'onboard-interviewer',
        transcriptId: 'a0BIj0000029lijMAB',
      }),
    );
  });

  it('should find matching ASR by Started_At_Time__c when Scheduled_For_Time__c is not suitable', async () => {
    // Event time is 2025-01-22T15:00:00
    // Started time is slightly before at 2025-01-22T14:30:16
    // Scheduled time is 3 days later at 2025-01-25T15:00:00
    const mockAsrRecords = [
      {
        Id: 'a0BIj0000029lijMAA',
        Scheduled_For_Time__c: null,
        Started_At_Time__c: null,
        ApplicationId__r: { Account: { PersonEmail: 'candidate@example.com' } },
      },
      {
        Id: 'a0BIj0000029lijMAB',
        Scheduled_For_Time__c: '2025-01-25T15:00:00.000Z', // 3 days after event time
        Started_At_Time__c: '2025-01-22T14:30:16.000Z', // Within 2 days of event
        ApplicationId__r: { Account: { PersonEmail: 'candidate@example.com' } },
      },
      {
        Id: 'a0BIj0000029lijMAC',
        Scheduled_For_Time__c: null,
        Started_At_Time__c: '2024-12-01T15:30:16.000Z',
        ApplicationId__r: { Account: { PersonEmail: 'candidate@example.com' } },
      },
    ];

    // Mock Salesforce query to return the ASR records
    mockSalesforceClient.querySOQL.mockResolvedValue(mockAsrRecords);

    // Create a mock webhook payload
    const mockEvent: APIGatewayProxyEvent = {
      pathParameters: {
        graderId: '005Ij000000SHNEIA4',
      },
      body: JSON.stringify({
        owner: { email: 'interviewer@crossover.com' },
        participants: [{ email: 'candidate@example.com' }],
        start_time: '2025-01-22T15:00:00',
      }),
    } as any as APIGatewayProxyEvent;

    // Call the handler
    const result = await handleReadAiWebhook(mockEvent);

    // Assertions
    expect(result.statusCode).toBe(200);
    expect(Salesforce.getAdminClient).toHaveBeenCalled();
    expect(mockSalesforceClient.querySOQL).toHaveBeenCalledWith(
      expect.stringContaining('SELECT Id, Scheduled_For_Time__c, Started_At_Time__c'),
    );
    expect(ReadAiTranscript.insertNew).toHaveBeenCalledWith(
      expect.objectContaining({
        asrId: 'a0BIj0000029lijMAB', // Should match this record based on Started_At_Time__c
        payload: expect.objectContaining({
          start_time: '2025-01-22T15:00:00',
        }),
      }),
    );
    expect(Sqs.sendTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'generate-summary',
        transcriptId: 'a0BIj0000029lijMAB',
      }),
    );
    expect(Sqs.sendTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'onboard-interviewer',
        transcriptId: 'a0BIj0000029lijMAB',
      }),
    );
  });

  it('should handle transcript collision by creating a new document with session ID when using grader ID', async () => {
    // Mock ASR records that would be returned for the grader
    const mockAsrRecords = [
      {
        Id: 'a0BIj0000029lijMAB',
        Scheduled_For_Time__c: '2025-01-22T13:00:00.000Z',
        Started_At_Time__c: '2025-01-21T17:30:16.000Z',
        ApplicationId__r: { Account: { PersonEmail: 'candidate@example.com' } },
      },
    ];

    // Mock Salesforce query to return the ASR records
    mockSalesforceClient.querySOQL.mockResolvedValue(mockAsrRecords);

    // Mock existing transcript
    (ReadAiTranscript.getById as jest.Mock).mockResolvedValue({
      id: 'a0BIj0000029lijMAB',
      asrId: 'a0BIj0000029lijMAB',
      payload: {
        // existing payload
      },
    });

    // Create a mock webhook payload with session_id and matching start time
    const mockEvent: APIGatewayProxyEvent = {
      pathParameters: {
        graderId: '005Ij000000SHNEIA4',
      },
      body: JSON.stringify({
        session_id: 'test-session-123',
        owner: { email: 'interviewer@crossover.com' },
        participants: [{ email: 'candidate@example.com' }],
        start_time: '2025-01-22T15:00:00',
      }),
    } as any as APIGatewayProxyEvent;

    // Call the handler
    const result = await handleReadAiWebhook(mockEvent);

    // Assertions
    expect(result.statusCode).toBe(200);
    expect(Salesforce.getAdminClient).toHaveBeenCalled();
    expect(mockSalesforceClient.querySOQL).toHaveBeenCalledWith(
      expect.stringContaining('SELECT Id, Scheduled_For_Time__c, Started_At_Time__c'),
    );
    expect(ReadAiTranscript.getById).toHaveBeenCalledWith('a0BIj0000029lijMAB');
    expect(ReadAiTranscript.insertNewWithId).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'a0BIj0000029lijMAB#test-session-123',
        asrId: 'a0BIj0000029lijMAB',
        payload: expect.objectContaining({
          session_id: 'test-session-123',
          owner: { email: 'interviewer@crossover.com' },
          participants: [{ email: 'candidate@example.com' }],
          start_time: '2025-01-22T15:00:00',
        }),
      }),
    );
    // Should not call insertNew since we found an existing transcript
    expect(ReadAiTranscript.insertNew).not.toHaveBeenCalled();
  });

  it('should find matching ASR through CalendlyActions when participant email does not match person email', async () => {
    // Mock ASR records where person email doesn't match participant email
    const mockAsrRecords = [
      {
        Id: 'a0BIj0000029lijMAA',
        Scheduled_For_Time__c: '2025-01-22T13:00:00.000Z',
        Started_At_Time__c: '2025-01-21T17:30:16.000Z',
        ApplicationId__r: { Account: { PersonEmail: 'different.email@example.com' } }, // Different email
      },
      {
        Id: 'a0BIj0000029lijMAB',
        Scheduled_For_Time__c: '2025-01-22T15:00:00.000Z',
        Started_At_Time__c: null,
        ApplicationId__r: { Account: { PersonEmail: 'another.email@example.com' } }, // Different email
      },
    ];

    // Mock CalendlyActions that will help identify the correct ASR
    const mockCalendlyActions = [
      {
        EventStartTime__c: '2025-01-22T15:00:00.000Z',
        ObjectId__c: 'a0BIj0000029lijMAB',
        EventPrimaryPublisherEmail__c: 'interviewer@crossover.com',
        InviteeEmail__c: 'candidate@example.com',
        Name: 'invitee.created',
        EventUuid__c: 'test-uuid-1',
      },
    ];

    // Mock Salesforce queries to return the mock data
    mockSalesforceClient.querySOQL.mockImplementation((query) => {
      if (query.includes('Application_Step_Result__c')) {
        return Promise.resolve(mockAsrRecords);
      }
      if (query.includes('CalendlyAction__c')) {
        return Promise.resolve(mockCalendlyActions);
      }
      return Promise.resolve([]);
    });

    // Create a mock webhook payload
    const mockEvent: APIGatewayProxyEvent = {
      pathParameters: {
        graderId: '005Ij000000SHNEIA4',
      },
      body: JSON.stringify({
        owner: { email: 'interviewer@crossover.com' },
        participants: [{ email: 'candidate@example.com' }], // This email doesn't match person emails
        start_time: '2025-01-22T15:00:00',
      }),
    } as any as APIGatewayProxyEvent;

    // Call the handler
    const result = await handleReadAiWebhook(mockEvent);

    // Assertions
    expect(result.statusCode).toBe(200);
    expect(Salesforce.getAdminClient).toHaveBeenCalled();

    // Should query both ASRs and CalendlyActions
    expect(mockSalesforceClient.querySOQL).toHaveBeenCalledWith(
      expect.stringContaining('SELECT Id, Scheduled_For_Time__c, Started_At_Time__c'),
    );
    expect(mockSalesforceClient.querySOQL).toHaveBeenCalledWith(expect.stringContaining('FROM CalendlyAction__c'));

    // Should create transcript with the correct ASR ID
    expect(ReadAiTranscript.insertNew).toHaveBeenCalledWith(
      expect.objectContaining({
        asrId: 'a0BIj0000029lijMAB',
        payload: expect.objectContaining({
          start_time: '2025-01-22T15:00:00',
        }),
      }),
    );

    // Should trigger summary generation and interviewer onboarding
    expect(Sqs.sendTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'generate-summary',
        transcriptId: 'a0BIj0000029lijMAB',
      }),
    );
    expect(Sqs.sendTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'onboard-interviewer',
        transcriptId: 'a0BIj0000029lijMAB',
      }),
    );
  });
});
