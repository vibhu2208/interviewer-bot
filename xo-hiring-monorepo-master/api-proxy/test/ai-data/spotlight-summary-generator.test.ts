import { InterviewBotClient, InterviewConversation } from '@trilogy-group/xoh-integration';
import { fetchMatchingInterviewData } from '../../src/ai-data/spotlight-summary-generator';
import { CandidateAssessment } from '../../src/ai-data/candidate';

jest.mock('@trilogy-group/xoh-integration', () => ({
  ...jest.requireActual('@trilogy-group/xoh-integration'),
  InterviewBotClient: jest.fn(),
}));

const mockFetchInterviewConversations = jest.fn();
(InterviewBotClient as jest.Mock).mockImplementation(() => ({
  fetchInterviewConversations: mockFetchInterviewConversations,
}));

describe('fetchMatchingInterviewData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INTERVIEW_BOT_API_URL = 'https://interview-bot.com';
  });

  const mockAssessments: CandidateAssessment[] = [
    {
      Name: 'AI Interview - Vanilla JS',
      ApplicationId__c: 'a0g8d000008aABCDEF',
      Application_Step_Id__r: {
        Display_Name__c: 'AI Interview - Vanilla JS',
        Provider__c: 'XOAssessments',
        External_Submission_Assessment_ID__c: 'skl-123',
        Badge_Description__c: 'badge-desc',
        Badge_Max_Proficiency__c: 5,
      },
      External_Submission_Id__c: 'sub-123',
      Badge_Earned__r: { Display_Name__c: 'Top Coder', Stars__c: 5 },
    },
    {
      Name: 'Some other assessment',
      ApplicationId__c: 'a0g8d000008aGHIJKL',
      Application_Step_Id__r: {
        Display_Name__c: 'Other Assessment',
        Provider__c: 'OtherProvider',
        External_Submission_Assessment_ID__c: 'skl-456',
        Badge_Description__c: 'other-badge-desc',
        Badge_Max_Proficiency__c: 3,
      },
      External_Submission_Id__c: 'sub-456',
      Badge_Earned__r: { Display_Name__c: 'Participant', Stars__c: 3 },
    },
    {
      Name: 'AI Interview without submission ID',
      ApplicationId__c: 'a0g8d000008aMNOPQR',
      Application_Step_Id__r: {
        Display_Name__c: 'AI Interview - No Sub ID',
        Provider__c: 'XOAssessments',
        External_Submission_Assessment_ID__c: 'skl-789',
        Badge_Description__c: 'badge-desc-3',
        Badge_Max_Proficiency__c: 5,
      },
      External_Submission_Id__c: null as any,
      Badge_Earned__r: { Display_Name__c: 'Top Coder', Stars__c: 5 },
    },
  ];

  const mockInterviewConversations: InterviewConversation[] = [
    {
      sessionId: 'sub-123',
      questionId: 'q-1',
      conversation: [{ role: 'Candidate', content: 'Hello' }],
    },
  ];

  it('should fetch and process matching interview data correctly, filtering out irrelevant assessments', async () => {
    mockFetchInterviewConversations.mockResolvedValue(mockInterviewConversations);

    const result = await fetchMatchingInterviewData(mockAssessments);

    expect(mockFetchInterviewConversations).toHaveBeenCalledTimes(1);
    expect(mockFetchInterviewConversations).toHaveBeenCalledWith({
      sessionIds: ['sub-123'],
    });

    expect(result).toEqual([
      {
        name: 'AI Interview - Vanilla JS',
        conversation: [{ role: 'Candidate', content: 'Hello' }],
      },
    ]);
  });

  it('should return an empty array and log error when client throws an error', async () => {
    const error = new Error('Client error');
    mockFetchInterviewConversations.mockRejectedValue(error);

    const result = await fetchMatchingInterviewData(mockAssessments);

    expect(result).toEqual([]);
    expect(mockFetchInterviewConversations).toHaveBeenCalledTimes(1);
  });

  it('should not call client if there are no valid session IDs', async () => {
    await fetchMatchingInterviewData([]);
    expect(mockFetchInterviewConversations).not.toHaveBeenCalled();

    const assessmentsWithNoSubId = mockAssessments.filter((a) => a.External_Submission_Id__c === null);
    await fetchMatchingInterviewData(assessmentsWithNoSubId);
    expect(mockFetchInterviewConversations).not.toHaveBeenCalled();
  });

  it('should fall back to an empty string for the name if matching assessment is not found', async () => {
    const modifiedResponse: InterviewConversation[] = [
      { ...mockInterviewConversations[0], sessionId: 'sub-not-found' },
    ];
    mockFetchInterviewConversations.mockResolvedValue(modifiedResponse);

    const result = await fetchMatchingInterviewData(mockAssessments);

    expect(result[0].name).toBe('');
  });
});
