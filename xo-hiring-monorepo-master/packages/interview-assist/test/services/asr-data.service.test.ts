import { AsrDataService } from '../../src/services/asr-data.service';
import { SalesforceClient } from '@trilogy-group/xoh-integration';
import { ProcessedAssessment } from '../../src/models/summary-generator.model';

const mockFetchInterviewConversations = jest.fn();
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  appendKeys: jest.fn(),
};

jest.doMock('@trilogy-group/xoh-integration', () => ({
  ...jest.requireActual('@trilogy-group/xoh-integration'),
  InterviewBotClient: jest.fn().mockImplementation(() => ({
    fetchInterviewConversations: mockFetchInterviewConversations,
  })),
  defaultLogger: jest.fn(() => mockLogger),
}));

describe('AsrDataService.getAIInterviewConversations', () => {
  let asrDataService: AsrDataService;
  const mockSfClient = {} as SalesforceClient;
  const originalEnv = process.env;

  beforeEach(async () => {
    jest.resetModules();
    process.env = { ...originalEnv };
    process.env.INTERVIEW_BOT_API_URL = 'http://fake-url.com';
    jest.clearAllMocks();
    const AsrDataServiceModule = await import('../../src/services/asr-data.service');
    asrDataService = new AsrDataServiceModule.AsrDataService(mockSfClient);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const mockAssessments: ProcessedAssessment[] = [
    {
      assessmentName: 'Test Assessment XO',
      stepDisplayName: 'XO Interview Step',
      applicationId: 'app123',
      provider: 'XOAssessments',
      externalSubmissionId: 'submission123',
    },
    {
      assessmentName: 'Test Assessment Other',
      stepDisplayName: 'Other Step',
      applicationId: 'app123',
      provider: 'OtherProvider',
      externalSubmissionId: 'submission456',
    },
    {
      assessmentName: 'Test Assessment XO No Sub ID',
      stepDisplayName: 'XO Interview Step No Sub ID',
      applicationId: 'app123',
      provider: 'XOAssessments',
      externalSubmissionId: undefined,
    },
  ];

  const mockClientResponse = [
    {
      sessionId: 'submission123',
      questionId: 'q-123',
      conversation: [{ role: 'Candidate', content: 'Hello there.' }],
    },
  ];

  it('should filter for XOAssessments, call client with sessionIds, and map response', async () => {
    mockFetchInterviewConversations.mockResolvedValue(mockClientResponse);

    const result = await asrDataService.getAIInterviewConversations(mockAssessments);

    expect(mockFetchInterviewConversations).toHaveBeenCalledTimes(1);
    expect(mockFetchInterviewConversations).toHaveBeenCalledWith({
      sessionIds: ['submission123'],
    });

    expect(result).toEqual([
      {
        sourceName: 'XO Interview Step',
        conversation: [{ role: 'Candidate', content: 'Hello there.' }],
      },
    ]);

    expect(mockLogger.info).toHaveBeenCalledWith(
      `Successfully fetched ${mockClientResponse.length} AI matching interview logs via client.`,
    );
  });

  it('should return an empty array if no assessments are from XOAssessments', async () => {
    const nonXoAssessments = mockAssessments.filter((a) => a.provider !== 'XOAssessments');
    const result = await asrDataService.getAIInterviewConversations(nonXoAssessments);

    expect(result).toEqual([]);
    expect(mockFetchInterviewConversations).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('No XOAssessments with session IDs found for candidate.');
  });

  it('should return empty array and log error if client fails', async () => {
    const error = new Error('Client request failed');
    mockFetchInterviewConversations.mockRejectedValue(error);

    const result = await asrDataService.getAIInterviewConversations(mockAssessments);

    expect(result).toEqual([]);
    expect(mockFetchInterviewConversations).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error fetching AI matching interview logs via InterviewBotClient:',
      error,
    );
  });

  it('should fall back to default name if matching assessment is not found', async () => {
    const clientResponseWithUnknownSession = [
      {
        sessionId: 'unknown-submission',
        questionId: 'q-456',
        conversation: [{ role: 'Interviewer', content: 'Tell me about yourself.' }],
      },
    ];
    mockFetchInterviewConversations.mockResolvedValue(clientResponseWithUnknownSession);

    const result = await asrDataService.getAIInterviewConversations(mockAssessments);

    expect(result).toHaveLength(1);
    expect(result[0].sourceName).toBe('AI Matching Interview');
    expect(result[0].conversation).toEqual(clientResponseWithUnknownSession[0].conversation);
  });

  it('should throw an error if INTERVIEW_BOT_API_URL is not set', async () => {
    delete process.env.INTERVIEW_BOT_API_URL;

    const { AsrDataService: AsrDataServiceNew } = await import('../../src/services/asr-data.service');
    const newAsrService = new AsrDataServiceNew(mockSfClient);
    const expectedError = new Error(
      'INTERVIEW_BOT_API_URL environment variable is not set. InterviewBotClient cannot be initialized.',
    );

    await expect(newAsrService.getAIInterviewConversations(mockAssessments)).rejects.toThrow(expectedError);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'INTERVIEW_BOT_API_URL environment variable is not set. InterviewBotClient cannot be initialized.',
    );
  });
});
