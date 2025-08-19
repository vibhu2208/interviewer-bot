import { DynamoDBStreamEvent } from 'aws-lambda';
import { Salesforce } from '@trilogy-group/xoh-integration';
import { Email } from '../../src/integrations/ses';
import { handler } from '../../src/handlers/email-sender';

// Mock dependencies
jest.mock('@trilogy-group/xoh-integration', () => ({
  Salesforce: {
    getAdminClient: jest.fn(),
    silent: jest.fn(),
  },
  defaultLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    resetKeys: jest.fn(),
    appendKeys: jest.fn(),
  }),
}));

jest.mock('../../src/integrations/ses', () => ({
  Email: {
    getTransporter: jest.fn(),
  },
}));

describe('email-sender handler', () => {
  const mockSalesforceClient = {
    querySOQL: jest.fn(),
  };

  const mockTransporter = {
    sendMail: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (Salesforce.getAdminClient as jest.Mock).mockResolvedValue(mockSalesforceClient);
    (Email.getTransporter as jest.Mock).mockReturnValue(mockTransporter);
  });

  it('should successfully process a DynamoDB stream event and send email', async () => {
    // Mock ASR data
    const mockAsr = {
      Id: 'a0BIj000001rIInMAM',
      ApplicationId__r: {
        Account: {
          Name: 'John Candidate',
        },
        Pipeline__r: {
          Name: 'Senior Developer',
          ManagerId__r: {
            Id: 'a0BIj000001rIInMAM',
            Email: 'pm+test@trilogy.com',
          },
        },
      },
      Grader__r: {
        Email: 'test@trilogy.com',
        Name: 'Jane Grader',
      },
      Grade_URL__c: 'https://grade.url',
    };

    mockSalesforceClient.querySOQL.mockResolvedValue([mockAsr]);

    // Create a mock DynamoDB Stream event
    const mockEvent: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            NewImage: {
              pk: { S: 'SUMMARY' },
              sk: { S: 'a0BIj000001rIInMAM#123' },
              summary: { S: 'Interview summary text' },
              reportUrl: { S: 'https://readai.url' },
            },
          },
        } as any,
      ],
    };

    // Call the handler
    await handler(mockEvent, {} as any);

    // Verify Salesforce query was called with correct ASR ID
    expect(Salesforce.getAdminClient).toHaveBeenCalled();
    expect(mockSalesforceClient.querySOQL).toHaveBeenCalledWith(
      expect.stringContaining("WHERE Id = 'a0BIj000001rIInMAM'"),
    );

    // Verify email was sent with correct data
    expect(mockTransporter.sendMail).toHaveBeenCalledWith({
      from: 'Interview Assist <team@crossover.com>',
      html: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Ready for Grading: John Candidate's Senior Developer Interview</title>
  </head>
  <body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
    <p>Dear Jane Grader,</p>

    <p>
      Please find below the AI-generated summary of your recent interview 
      with <strong>John Candidate</strong> for the <strong>Senior Developer</strong> role.
    </p>

    <p>
      The full interview recording is available on Read.AI: 
      <a href="https://readai.url" target="_blank">https://readai.url</a>
      <br/>
      Please grade the candidate: 
      <a href="https://grade.url" target="_blank">https://grade.url</a>
    </p>

    <p>Interview summary text</p>


    <p>
      Please don’t hesitate to reach out if you need any clarification 
      or have feedback about this summary.
    </p>

    <p>Regards,<br/>
    Crossover</p>
  </body>
</html>`,
      replyTo: 'Interview Assist <team@crossover.com>',
      subject: "Ready for Grading: John Candidate's Senior Developer Interview",
      to: 'test@trilogy.com',
      cc: ['pm+test@trilogy.com'],
    });
  });

  it('should skip records that are not INSERT', async () => {
    const mockEvent: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'REMOVE',
          dynamodb: {
            NewImage: {
              pk: { S: 'SUMMARY' },
              sk: { S: 'asrId#123' },
            },
          },
        } as any,
      ],
    };

    await handler(mockEvent, {} as any);

    expect(mockTransporter.sendMail).not.toHaveBeenCalled();
  });

  it('should skip records that are not SUMMARY records', async () => {
    const mockEvent: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            NewImage: {
              pk: { S: 'NOT_SUMMARY' },
              sk: { S: 'asrId#123' },
            },
          },
        } as any,
      ],
    };

    await handler(mockEvent, {} as any);

    expect(mockTransporter.sendMail).not.toHaveBeenCalled();
  });

  it('should handle missing NewImage in record', async () => {
    const mockEvent: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {},
        } as any,
      ],
    };

    await handler(mockEvent, {} as any);

    expect(mockTransporter.sendMail).not.toHaveBeenCalled();
  });

  it('should skip sending email and log error when ASR is not found', async () => {
    mockSalesforceClient.querySOQL.mockResolvedValue([]);

    const mockEvent: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            NewImage: {
              pk: { S: 'SUMMARY' },
              sk: { S: 'nonexistent#123' },
              summary: { S: 'Summary text' },
              reportUrl: { S: 'https://readai.url' },
            },
          },
        } as any,
      ],
    };

    await handler(mockEvent, {} as any);

    expect(mockTransporter.sendMail).not.toHaveBeenCalled();
  });
});
