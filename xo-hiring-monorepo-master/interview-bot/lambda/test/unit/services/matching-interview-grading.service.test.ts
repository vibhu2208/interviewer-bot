import { MatchingInterviewGradingService } from '../../../src/services/matching-interview-grading.service';
import { SessionDocument } from '../../../src/model/session';
import { QuestionDocument, ConversationElement } from '../../../src/model/question';
import { R2Document } from '../../../src/schemas/matching-interview.schema';
import { RequirementMetEnum } from '../../../src/schemas/matching-interview-grading.schema';
import { replacePlaceholders } from '../../../src/common/util';
import { ObservabilityService } from '../../../src/services/observability.service';
import { R2DocumentFetcher } from '../../../src/services/r2-document-fetcher.service';
import { LLMService } from '../../../src/integrations/llm';

// Mocks
jest.mock('../../../src/common/util');
jest.mock('../../../src/services/observability.service');
jest.mock('../../../src/services/r2-document-fetcher.service');
jest.mock('../../../src/integrations/llm');

const mockedReplacePlaceholders = replacePlaceholders as jest.MockedFunction<typeof replacePlaceholders>;
const mockedObservabilityService = ObservabilityService as jest.Mocked<typeof ObservabilityService>;
const mockedR2DocumentFetcher = R2DocumentFetcher as jest.Mocked<typeof R2DocumentFetcher>;
const mockedLLMService = LLMService as jest.Mocked<typeof LLMService>;

describe('MatchingInterviewGradingService', () => {
  let mockSession: SessionDocument;
  let mockQuestion: QuestionDocument;
  let mockR2Document: R2Document;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSession = { id: 'session123' } as SessionDocument;

    mockQuestion = {
      id: 'question123',
      questionId: 'q123',
      question: 'Test question',
      perfectAnswer: 'Perfect answer',
      pk: 'SESSION#session123',
      sk: 'QUESTION#question123',
      conversation: [
        { role: 'user', content: 'Hello, I am excited about this role.' },
        { role: 'assistant', content: 'Great! Tell me about your experience.' },
        { role: 'user', content: 'I have 5 years of experience in software development.' },
      ] as ConversationElement[],
      state: 'Completed',
    } as QuestionDocument;

    mockR2Document = {
      role: 'Senior Software Developer',
      minimumBarRequirements: 'Experience with React, Node.js, and team leadership',
      cultureFit: {
        loveFactors: 'Innovation, collaboration, continuous learning',
        hateFactors: 'Micromanagement, rigid processes',
      },
    } as R2Document;
    mockedR2DocumentFetcher.fetch.mockResolvedValue(mockR2Document);

    // Mock ObservabilityService methods
    mockedObservabilityService.trackGradingPerformance.mockResolvedValue();
    mockedObservabilityService.trackFinalScore.mockResolvedValue();
    mockedObservabilityService.trackRequirementsBreakdown.mockResolvedValue();
    mockedObservabilityService.trackGradingError.mockResolvedValue();
  });

  describe('grade', () => {
    it('should successfully grade an interview and return structured results', async () => {
      const mockGradingResult = {
        interviewerQuality: {
          score: 85,
          summary: 'Good interviewing technique with clear questions',
          improvements: 'Could ask more follow-up questions for deeper insights',
        },
        gradingRubricResults: {
          requirements: [
            {
              requirement: 'Experience with React',
              met: 'YES',
              evidence: 'Candidate mentioned 5 years of software development experience',
              gaps: 'No specific React experience mentioned',
            },
          ],
        },
        comprehensiveProfile: {
          capabilities: ['Software development', 'Technical problem solving', 'Strong technical background'],
          experience: ['5 years of software development experience'],
          skillGaps: ['No specific React experience mentioned'],
          uncertainties: ['Leadership experience not explored in detail'],
          concerns: ['None identified in this conversation'],
          notes: ['Excited about the role and growth opportunities', 'Good alignment with technical requirements'],
        },
      };

      const mockPrompt = 'Generated prompt with conversation details';
      const mockUsage = { totalTokens: 150 };
      const mockReasoning =
        'The candidate shows strong technical background but needs more probing on React experience.';

      mockedReplacePlaceholders.mockReturnValue(mockPrompt);
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1500,
        usage: mockUsage,
        reasoning: mockReasoning,
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      expect(mockedLLMService.callWithStructuredOutput).toHaveBeenCalledWith({
        systemPrompt: mockPrompt,
        conversation: [
          expect.objectContaining({
            content: expect.stringContaining('Hello, I am excited about this role.'),
          }),
        ],
        schema: expect.any(Object),
      });
      expect(mockQuestion.state).toBe('Completed');
      expect(result).toEqual({
        grading: mockGradingResult,
        finalScore: 10,
        reasoning: mockReasoning,
      });
    });

    it('should handle LLM response without reasoning', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            {
              requirement: 'Experience with React',
              met: 'YES',
              evidence: 'Strong evidence',
            },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1200,
        usage: { totalTokens: 100 },
        // No reasoning field
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      expect(result).toEqual({
        grading: mockGradingResult,
        finalScore: 10,
        reasoning: undefined,
      });
    });

    it('should handle empty conversation gracefully', async () => {
      const questionWithEmptyConversation = {
        ...mockQuestion,
        conversation: [],
      };

      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1000,
        usage: { totalTokens: 100 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, questionWithEmptyConversation);

      expect(result).toEqual({ grading: mockGradingResult, finalScore: 0, reasoning: undefined });
    });

    it('should throw error when replacePlaceholders returns null', async () => {
      mockedReplacePlaceholders.mockReturnValue(null);

      await expect(MatchingInterviewGradingService.grade(mockSession, mockQuestion)).rejects.toThrow('Prompt is null');
    });

    it('should handle LLMService failure', async () => {
      const error = new Error('LLM service failed');
      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue(error);

      await expect(MatchingInterviewGradingService.grade(mockSession, mockQuestion)).rejects.toThrow(
        'LLM service failed',
      );
    });

    it('should pass correct parameters to LLMService', async () => {
      const mockPrompt = 'Test prompt';
      mockedReplacePlaceholders.mockReturnValue(mockPrompt);
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: {
          object: {
            gradingRubricResults: {
              requirements: [
                {
                  requirement: 'Experience with React',
                  met: 'YES',
                },
              ],
            },
          },
        },
        responseTimeMs: 1000,
        usage: { totalTokens: 100 },
      });

      await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      expect(mockedLLMService.callWithStructuredOutput).toHaveBeenCalledWith({
        systemPrompt: mockPrompt,
        conversation: [
          expect.objectContaining({ content: expect.stringContaining('Hello, I am excited about this role.') }),
        ],
        schema: expect.any(Object),
      });
    });
  });

  describe('calculateScore', () => {
    it('should calculate correct score for all YES requirements', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { requirement: 'Requirement 1', met: 'YES', evidence: 'Evidence 1' },
            { requirement: 'Requirement 2', met: 'YES', evidence: 'Evidence 2' },
            { requirement: 'Requirement 3', met: 'YES', evidence: 'Evidence 3' },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1200,
        usage: { totalTokens: 200 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      expect(result.finalScore).toBe(10);
    });

    it('should calculate correct score for all NO requirements', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { requirement: 'Requirement 1', met: 'NO', evidence: 'Evidence 1' },
            { requirement: 'Requirement 2', met: 'NO', evidence: 'Evidence 2' },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1000,
        usage: { totalTokens: 180 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      expect(result.finalScore).toBe(0);
    });

    it('should calculate correct score for all WEAK_PASS requirements', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { requirement: 'Requirement 1', met: 'WEAK_PASS', evidence: 'Evidence 1' },
            { requirement: 'Requirement 2', met: 'WEAK_PASS', evidence: 'Evidence 2' },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 900,
        usage: { totalTokens: 150 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      expect(result.finalScore).toBe(10);
    });

    it('should calculate correct score for all UNCLEAR requirements', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { requirement: 'Requirement 1', met: 'UNCLEAR', evidence: 'Evidence 1' },
            { requirement: 'Requirement 2', met: 'UNCLEAR', evidence: 'Evidence 2' },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 800,
        usage: { totalTokens: 150 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      expect(result.finalScore).toBe(8);
    });

    it('should calculate correct score for mixed requirements', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { requirement: 'Requirement 1', met: 'YES', evidence: 'Evidence 1' },
            { requirement: 'Requirement 2', met: 'WEAK_PASS', evidence: 'Evidence 2' },
            { requirement: 'Requirement 3', met: 'UNCLEAR', evidence: 'Evidence 3' },
            { requirement: 'Requirement 4', met: 'NO', evidence: 'Evidence 4' },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1300,
        usage: { totalTokens: 150 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      // numPass = 2 (YES + WEAK_PASS), numUnclear = 1, numRejected = 1, total = 4
      // Since numRejected > 0: 8 * ((2 + 1) / 4) = 8 * 0.75 = 6
      expect(result.finalScore).toBe(6);
    });

    it('should calculate correct score for realistic scenario', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { requirement: 'Technical Experience', met: 'YES', evidence: 'Strong evidence' },
            { requirement: 'Leadership Skills', met: 'WEAK_PASS', evidence: 'Some evidence' },
            { requirement: 'Domain Knowledge', met: 'YES', evidence: 'Clear evidence' },
            { requirement: 'Communication Skills', met: 'WEAK_PASS', evidence: 'Basic evidence' },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1400,
        usage: { totalTokens: 150 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      // numPass = 4 (2 YES + 2 WEAK_PASS), total = 4
      // Since numPass === total: 10
      expect(result.finalScore).toBe(10);
    });

    it('should return 0 for empty requirements array', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 600,
        usage: { totalTokens: 150 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      expect(result.finalScore).toBe(0);
    });

    it('should handle single requirement scoring correctly', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [{ requirement: 'Single Requirement', met: 'WEAK_PASS', evidence: 'Some evidence' }],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 700,
        usage: { totalTokens: 150 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      // numPass = 1 (WEAK_PASS), total = 1
      // Since numPass === total: 10
      expect(result.finalScore).toBe(10);
    });

    it('should calculate score with high precision for complex scenarios', async () => {
      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { requirement: 'Req 1', met: 'YES', evidence: 'Evidence' },
            { requirement: 'Req 2', met: 'YES', evidence: 'Evidence' },
            { requirement: 'Req 3', met: 'UNCLEAR', evidence: 'Evidence' },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1100,
        usage: { totalTokens: 150 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSession, mockQuestion);

      // numPass = 2 (YES), numUnclear = 1, numRejected = 0, total = 3
      // Since numRejected === 0 and numPass + numUnclear === total: 80 + 20 * (2 / 3) = 80 + 13.33... = 93.33...
      expect(result.finalScore).toBeCloseTo(9.33, 2);
    });
  });

  describe('observability tracking', () => {
    it('should track grading performance and final score when session has experiment group', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-2',
        skillId: '19100000-0000-0000-0000-000000000000',
      } as SessionDocument;

      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { met: 'YES' as RequirementMetEnum },
            { met: 'WEAK_PASS' as RequirementMetEnum },
            { met: 'YES' as RequirementMetEnum },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1500,
        usage: { totalTokens: 150 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion);

      expect(result).toEqual({
        grading: mockGradingResult,
        finalScore: 10, // numPass = 3 (2 YES + 1 WEAK_PASS), total = 3, so 10
        reasoning: undefined,
      });

      expect(mockedObservabilityService.trackGradingPerformance).toHaveBeenCalledWith(
        'group-2',
        '19100000-0000-0000-0000-000000000000',
        1500,
        150,
      );
      expect(mockedObservabilityService.trackFinalScore).toHaveBeenCalledWith(
        'group-2',
        '19100000-0000-0000-0000-000000000000',
        10,
      );
    });

    it('should not track metrics when session has no experiment group', async () => {
      const sessionWithoutExperimentGroup = { ...mockSession, experiment_group: undefined };

      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { met: 'YES' as RequirementMetEnum },
            { met: 'WEAK_PASS' as RequirementMetEnum },
            { met: 'YES' as RequirementMetEnum },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1200,
        usage: { totalTokens: 200 },
      });

      const result = await MatchingInterviewGradingService.grade(sessionWithoutExperimentGroup, mockQuestion);

      expect(result).toEqual({
        grading: mockGradingResult,
        finalScore: 10, // numPass = 3 (2 YES + 1 WEAK_PASS), total = 3, so 10
        reasoning: undefined,
      });

      expect(mockedObservabilityService.trackGradingPerformance).not.toHaveBeenCalled();
      expect(mockedObservabilityService.trackFinalScore).not.toHaveBeenCalled();
    });

    it('should handle observability service errors gracefully', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-2',
        skillId: '19100000-0000-0000-0000-000000000000',
      } as SessionDocument;

      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { met: 'YES' as RequirementMetEnum },
            { met: 'WEAK_PASS' as RequirementMetEnum },
            { met: 'YES' as RequirementMetEnum },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1800,
        usage: { totalTokens: 300 },
      });
      mockedObservabilityService.trackGradingPerformance.mockRejectedValueOnce(new Error('CloudWatch error'));
      mockedObservabilityService.trackFinalScore.mockRejectedValueOnce(new Error('CloudWatch error'));

      // Should not throw
      const result = await MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion);

      expect(result).toEqual({
        grading: mockGradingResult,
        finalScore: 10, // numPass = 3 (2 YES + 1 WEAK_PASS), total = 3, so 10
        reasoning: undefined,
      });

      expect(mockedObservabilityService.trackGradingPerformance).toHaveBeenCalledTimes(1);
      expect(mockedObservabilityService.trackFinalScore).toHaveBeenCalledTimes(1);
    });

    it('should track performance with correct model and skill parameters', async () => {
      const sessionWithDifferentSkill = {
        ...mockSession,
        skillId: '89000000-0000-0000-0000-000000000000',
        experiment_group: 'group-3',
      } as SessionDocument;

      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [
            { met: 'YES' as RequirementMetEnum },
            { met: 'WEAK_PASS' as RequirementMetEnum },
            { met: 'YES' as RequirementMetEnum },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1600,
        usage: { totalTokens: 250 },
      });

      await MatchingInterviewGradingService.grade(sessionWithDifferentSkill, mockQuestion);

      expect(mockedObservabilityService.trackGradingPerformance).toHaveBeenCalledWith(
        'group-3',
        '89000000-0000-0000-0000-000000000000',
        1600,
        250,
      );
      expect(mockedObservabilityService.trackFinalScore).toHaveBeenCalledWith(
        'group-3',
        '89000000-0000-0000-0000-000000000000',
        10, // numPass = 3 (2 YES + 1 WEAK_PASS), total = 3, so 10
      );
    });

    it('should track with different final scores correctly', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-2',
        skillId: '19100000-0000-0000-0000-000000000000',
      } as SessionDocument;

      const mockLowScoreGrading = {
        gradingRubricResults: {
          requirements: [{ met: 'NO' as RequirementMetEnum }, { met: 'WEAK_PASS' as RequirementMetEnum }],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockLowScoreGrading },
        responseTimeMs: 1000,
        usage: { totalTokens: 180 },
      });

      const result = await MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion);

      // numPass = 1 (WEAK_PASS), numUnclear = 0, numRejected = 1, total = 2
      // Since numRejected > 0: 8 * ((1 + 0) / 2) = 8 * 0.5 = 4
      const expectedScore = 4;
      expect(result.finalScore).toBe(expectedScore);

      expect(mockedObservabilityService.trackFinalScore).toHaveBeenCalledWith(
        'group-2',
        '19100000-0000-0000-0000-000000000000',
        expectedScore,
      );
    });

    it('should track requirements breakdown when session has experiment group', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-2',
        skillId: '19100000-0000-0000-0000-000000000000',
      } as SessionDocument;

      const mockGradingWithMixedRequirements = {
        gradingRubricResults: {
          requirements: [
            { met: 'YES' as RequirementMetEnum },
            { met: 'NO' as RequirementMetEnum },
            { met: 'WEAK_PASS' as RequirementMetEnum },
            { met: 'UNCLEAR' as RequirementMetEnum },
            { met: 'YES' as RequirementMetEnum },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingWithMixedRequirements },
        responseTimeMs: 1700,
        usage: { totalTokens: 200 },
      });

      await MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion);

      expect(mockedObservabilityService.trackRequirementsBreakdown).toHaveBeenCalledWith(
        'group-2',
        '19100000-0000-0000-0000-000000000000',
        {
          YES: 2,
          NO: 1,
          WEAK_PASS: 1,
          UNCLEAR: 1,
        },
      );
    });

    it('should track requirements breakdown with all UNCLEAR requirements', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-3',
        skillId: '89000000-0000-0000-0000-000000000000',
      } as SessionDocument;

      const mockAllUnclearGrading = {
        gradingRubricResults: {
          requirements: [
            { met: 'UNCLEAR' as RequirementMetEnum },
            { met: 'UNCLEAR' as RequirementMetEnum },
            { met: 'UNCLEAR' as RequirementMetEnum },
          ],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockAllUnclearGrading },
        responseTimeMs: 1200,
        usage: { totalTokens: 150 },
      });

      await MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion);

      expect(mockedObservabilityService.trackRequirementsBreakdown).toHaveBeenCalledWith(
        'group-3',
        '89000000-0000-0000-0000-000000000000',
        {
          YES: 0,
          NO: 0,
          WEAK_PASS: 0,
          UNCLEAR: 3,
        },
      );
    });

    it('should track requirements breakdown with empty requirements array', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-2',
        skillId: '19100000-0000-0000-0000-000000000000',
      } as SessionDocument;

      const mockEmptyRequirementsGrading = {
        gradingRubricResults: {
          requirements: [],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockEmptyRequirementsGrading },
        responseTimeMs: 800,
        usage: { totalTokens: 100 },
      });

      await MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion);

      expect(mockedObservabilityService.trackRequirementsBreakdown).toHaveBeenCalledWith(
        'group-2',
        '19100000-0000-0000-0000-000000000000',
        {
          YES: 0,
          NO: 0,
          WEAK_PASS: 0,
          UNCLEAR: 0,
        },
      );
    });

    it('should not track requirements breakdown when session has no experiment group', async () => {
      const sessionWithoutExperimentGroup = { ...mockSession, experiment_group: undefined };

      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [{ met: 'YES' as RequirementMetEnum }, { met: 'UNCLEAR' as RequirementMetEnum }],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1100,
        usage: { totalTokens: 200 },
      });

      await MatchingInterviewGradingService.grade(sessionWithoutExperimentGroup, mockQuestion);

      expect(mockedObservabilityService.trackRequirementsBreakdown).not.toHaveBeenCalled();
    });

    it('should handle requirements breakdown tracking errors gracefully', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-2',
        skillId: '19100000-0000-0000-0000-000000000000',
      } as SessionDocument;

      const mockGradingResult = {
        gradingRubricResults: {
          requirements: [{ met: 'YES' as RequirementMetEnum }, { met: 'UNCLEAR' as RequirementMetEnum }],
        },
      };

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue({
        response: { object: mockGradingResult },
        responseTimeMs: 1400,
        usage: { totalTokens: 300 },
      });
      mockedObservabilityService.trackRequirementsBreakdown.mockRejectedValueOnce(new Error('CloudWatch error'));

      // Should not throw
      const result = await MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion);

      expect(result).toEqual({
        grading: mockGradingResult,
        finalScore: 9, // numPass = 1 (YES), numUnclear = 1, numRejected = 0, total = 2
        // Since numRejected === 0 and numPass + numUnclear === total: 8 + (10 - 8) * (1 / 2) = 8 + 1 = 9
        reasoning: undefined,
      });

      expect(mockedObservabilityService.trackRequirementsBreakdown).toHaveBeenCalledTimes(1);
    });

    it('should track grading errors when LLMService fails', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-2',
        skillId: '19100000-0000-0000-0000-000000000000',
      } as SessionDocument;

      const serviceError = new Error('LLM service failed - rate limit exceeded');
      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue(serviceError);

      await expect(MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion)).rejects.toThrow(
        'LLM service failed - rate limit exceeded',
      );

      expect(mockedObservabilityService.trackGradingError).toHaveBeenCalledWith(
        'group-2',
        '19100000-0000-0000-0000-000000000000',
      );
    });

    it('should not track errors when session has no experiment group', async () => {
      const sessionWithoutExperimentGroup = { ...mockSession, experiment_group: undefined };

      const error = new Error('Some grading failure');
      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue(error);

      await expect(MatchingInterviewGradingService.grade(sessionWithoutExperimentGroup, mockQuestion)).rejects.toThrow(
        'Some grading failure',
      );

      expect(mockedObservabilityService.trackGradingError).not.toHaveBeenCalled();
    });

    it('should handle error tracking failures gracefully', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-2',
        skillId: '19100000-0000-0000-0000-000000000000',
      } as SessionDocument;

      const originalError = new Error('Original grading failure');
      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue(originalError);
      mockedObservabilityService.trackGradingError.mockRejectedValueOnce(new Error('Tracking failed'));

      // Should still throw the original error, not the tracking error
      await expect(MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion)).rejects.toThrow(
        'Original grading failure',
      );

      expect(mockedObservabilityService.trackGradingError).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error objects when tracking', async () => {
      const mockSessionWithExperimentGroup = {
        ...mockSession,
        experiment_group: 'group-2',
        skillId: '19100000-0000-0000-0000-000000000000',
      } as SessionDocument;

      mockedReplacePlaceholders.mockReturnValue('Generated prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue('String error instead of Error object');

      await expect(MatchingInterviewGradingService.grade(mockSessionWithExperimentGroup, mockQuestion)).rejects.toThrow(
        'String error instead of Error object',
      );

      expect(mockedObservabilityService.trackGradingError).toHaveBeenCalledWith(
        'group-2',
        '19100000-0000-0000-0000-000000000000',
      );
    });
  });
});
