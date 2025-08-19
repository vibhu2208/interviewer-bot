import * as sf from '@trilogy-group/xoh-integration';
import { handler } from '../../src/handlers/grader-reminder';
import { Email } from '../../src/integrations/ses';
import { Config } from '../../src/models/config';
import { Interviewer } from '../../src/models/interviewer';

jest.mock('../../src/integrations/ses');
jest.mock('../../src/models/interviewer');
jest.mock('../../src/models/config');

jest.mock('@trilogy-group/xoh-integration', () => {
  return {
    // Provide a mock defaultLogger that returns an object with .info, .warn, .error
    defaultLogger: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),

    // Also mock Salesforce in case you need it
    Salesforce: {
      getAdminClient: jest.fn(),
      silent: jest.fn(),
    },
  };
});

describe('grader-reminder handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should send reminders to interviewers who had interviews yesterday but are not onboarded', async () => {
    // Mock config
    (Config.fetch as jest.Mock).mockResolvedValue({ sendReminderEmail: true });

    // Mock Salesforce data (two graders, one canceled)
    (sf.Salesforce.getAdminClient as jest.Mock).mockReturnValue({
      querySOQL: async (query: string) => {
        if (query.includes('invitee.canceled')) {
          // canceledAsrIds
          return [{ ObjectId__c: 'ASR-111' }];
        } else if (query.includes('ObjectId__c NOT IN')) {
          // interviewAsrIds
          return [{ ObjectId__c: 'ASR-222' }, { ObjectId__c: 'ASR-333' }];
        } else {
          // graders
          return [
            {
              Grader__r: { Id: 'G-100', Email: 'grader1@example.com', Name: 'Grader One' },
            },
            {
              Grader__r: { Id: 'G-101', Email: 'grader2@example.com', Name: 'Grader Two' },
            },
          ];
        }
      },
    });

    // Mock Interviewer DB data: G-100 is onboarded, G-101 is not
    (Interviewer.getByIds as jest.Mock).mockResolvedValue([{ interviewerId: 'G-100', isOnboarded: true }]);

    // Mock Email calls
    const mockSendMail = jest.fn();
    (Email.getTransporter as jest.Mock).mockReturnValue({ sendMail: mockSendMail });

    // Invoke the function
    await handler();

    // Validate that only G-101 gets an email
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mailArgs = mockSendMail.mock.calls[0][0];
    expect(mailArgs.to).toBe('grader2@example.com');
    expect(mailArgs.subject).toContain('Enable Interview Summaries');
    expect(mailArgs.html).toContain('Crossover now offers automatic interview notes generation');
    expect(mailArgs.from).toBe('Interview Assist <team@crossover.com>');
    expect(mailArgs.replyTo).toBe('Interview Assist <team@crossover.com>');
  });

  it('should skip sending email if sendReminderEmail is false (dry run)', async () => {
    // Mock config to be dry run
    (Config.fetch as jest.Mock).mockResolvedValue({ sendReminderEmail: false });

    // Return some data from Salesforce
    (sf.Salesforce.getAdminClient as jest.Mock).mockReturnValue({
      querySOQL: async () => [{ Grader__r: { Id: 'G-200', Email: 'foo@bar.com' } }],
    });

    // No one is onboarded
    (Interviewer.getByIds as jest.Mock).mockResolvedValue([]);

    const mockSendMail = jest.fn();
    (Email.getTransporter as jest.Mock).mockReturnValue({ sendMail: mockSendMail });

    await handler();
    // Should log but not call transporter.sendMail
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
