import { MatchingInterviewService } from '../../../src/services/matching-interview.service';
import { SessionDocument } from '../../../src/model/session';
import { QuestionDocument, ConversationElement, Question } from '../../../src/model/question';
import { Config } from '../../../src/config';
import { replacePlaceholders, cleanupBedrockConversation } from '../../../src/common/util';
import { AppSync } from '../../../src/integrations/appsync';
import { DynamoDB } from '../../../src/integrations/dynamodb';
import { Sqs } from '../../../src/integrations/sqs';
import { LLMService } from '../../../src/integrations/llm';
import { MatchingInterviewGradingService } from '../../../src/services/matching-interview-grading.service';
import { ObservabilityService } from '../../../src/services/observability.service';
import { R2DocumentFetcher } from '../../../src/services/r2-document-fetcher.service';

// Mocks
jest.mock('../../../src/config');
jest.mock('../../../src/common/util');
jest.mock('../../../src/integrations/appsync');
jest.mock('../../../src/integrations/dynamodb');
jest.mock('../../../src/integrations/sqs');
jest.mock('../../../src/integrations/llm');
jest.mock('../../../src/model/question');
jest.mock('../../../src/services/matching-interview-grading.service');
jest.mock('../../../src/services/observability.service');
jest.mock('../../../src/services/r2-document-fetcher.service');

const mockedConfig = Config as jest.Mocked<typeof Config>;
const mockedReplacePlaceholders = replacePlaceholders as jest.MockedFunction<typeof replacePlaceholders>;
const mockedCleanupBedrockConversation = cleanupBedrockConversation as jest.MockedFunction<
  typeof cleanupBedrockConversation
>;
const mockedAppSync = AppSync as jest.Mocked<typeof AppSync>;
const mockedDynamoDB = DynamoDB as jest.Mocked<typeof DynamoDB>;
const mockedSqs = Sqs as jest.Mocked<typeof Sqs>;
const mockedLLMService = LLMService as jest.Mocked<typeof LLMService>;
const mockedQuestion = Question as jest.Mocked<typeof Question>;
const mockedMatchingInterviewGradingService = MatchingInterviewGradingService as jest.Mocked<
  typeof MatchingInterviewGradingService
>;
const mockedObservabilityService = ObservabilityService as jest.Mocked<typeof ObservabilityService>;
const mockedR2DocumentFetcher = R2DocumentFetcher as jest.Mocked<typeof R2DocumentFetcher>;

describe('MatchingInterviewService', () => {
  let service: MatchingInterviewService;
  let mockSession: SessionDocument;
  let mockQuestion: QuestionDocument;
  let mockR2Document: any;

  beforeEach(() => {
    jest.resetAllMocks();

    service = new MatchingInterviewService();

    mockSession = {
      id: 'session123',
      skillId: '19100000-0000-0000-0000-000000000000',
      experiment_group: 'group-2',
      testTaker: {
        name: 'John Doe',
      },
    } as SessionDocument;

    mockQuestion = {
      id: 'question123',
      questionId: 'q123',
      question: 'Test question',
      perfectAnswer: 'Perfect answer',
      pk: 'SESSION#session123',
      sk: 'QUESTION#question123',
      conversation: [{ role: 'user', content: 'Hello, I am excited about this role.' }] as ConversationElement[],
      state: null,
    } as QuestionDocument;

    mockR2Document = {
      role: 'Software Engineer',
      minimumBarRequirements: 'Strong programming skills',
      cultureFit: {
        loveFactors: 'Collaboration, Innovation',
        hateFactors: 'Micromanagement, Bureaucracy',
      },
    };

    mockedConfig.getMatchingInterviewLlmModel.mockReturnValue({
      model: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
      provider: 'bedrock',
      projectName: 'test',
    });
    mockedCleanupBedrockConversation.mockImplementation((conv: any) => conv);
    mockedR2DocumentFetcher.fetch.mockResolvedValue(mockR2Document);

    // Default mocks for ObservabilityService
    mockedObservabilityService.trackConversationTurn.mockResolvedValue();
    mockedObservabilityService.trackLLMPerformance.mockResolvedValue();
    mockedObservabilityService.trackGradingPerformance.mockResolvedValue();
    mockedObservabilityService.trackFinalScore.mockResolvedValue();
    mockedObservabilityService.trackLLMError.mockResolvedValue();
  });

  describe('processAnswerAttempt', () => {
    it('should initialize conversation and add user message', async () => {
      const questionWithoutConversation = {
        ...mockQuestion,
        conversation: undefined,
      };

      await service.processAnswerAttempt('Hello there', questionWithoutConversation, mockSession, 1);

      expect(questionWithoutConversation.conversation).toEqual([{ role: 'user', content: 'Hello there' }]);
      expect(mockedQuestion.updateConversation).toHaveBeenCalledWith('session123', 'question123', [
        { role: 'user', content: 'Hello there' },
      ]);
      expect(mockedSqs.sendGptMessage).toHaveBeenCalledWith({
        type: 'matching-interview-user-message',
        questionId: 'question123',
        sessionId: 'session123',
      });
    });

    it('should use default welcome message when answer is empty and conversation is null', async () => {
      const questionWithoutConversation = {
        ...mockQuestion,
        conversation: undefined,
      };

      await service.processAnswerAttempt('', questionWithoutConversation, mockSession, 1);

      expect(questionWithoutConversation.conversation).toEqual([{ role: 'user', content: 'Hi' }]);
      expect(mockedQuestion.updateConversation).toHaveBeenCalledWith('session123', 'question123', [
        { role: 'user', content: 'Hi' },
      ]);
    });

    it('should add user message to existing conversation', async () => {
      const existingConversation = [{ role: 'assistant', content: 'Previous message' }] as ConversationElement[];
      const questionWithConversation = {
        ...mockQuestion,
        conversation: existingConversation,
      };

      await service.processAnswerAttempt('My response', questionWithConversation, mockSession, 1);

      expect(questionWithConversation.conversation).toEqual([
        { role: 'assistant', content: 'Previous message' },
        { role: 'user', content: 'My response' },
      ]);
    });

    it('should not add empty user message when conversation exists', async () => {
      const existingConversation = [{ role: 'assistant', content: 'Previous message' }] as ConversationElement[];
      const questionWithConversation = {
        ...mockQuestion,
        conversation: existingConversation,
      };

      await service.processAnswerAttempt('', questionWithConversation, mockSession, 1);

      expect(questionWithConversation.conversation).toEqual([{ role: 'assistant', content: 'Previous message' }]);
      expect(mockedSqs.sendGptMessage).toHaveBeenCalled();
    });
  });

  describe('generateAssistantResponse', () => {
    it('should generate response and continue conversation when not ready for grading', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Tell me more about your experience',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1500,
        usage: { totalTokens: 150 },
        reasoning: 'The candidate seems engaged, need to probe deeper into their technical background.',
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      await service.generateAssistantResponse(mockQuestion, mockSession);

      expect(mockedR2DocumentFetcher.fetch).toHaveBeenCalledWith(mockSession);
      expect(mockedReplacePlaceholders).toHaveBeenCalledWith(
        expect.stringContaining('You are a seasoned hiring manager'),
        expect.objectContaining({
          session: mockSession,
          r2Document: mockR2Document,
          currentTime: expect.any(String),
        }),
      );
      expect(mockedLLMService.callWithStructuredOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'System prompt',
          conversation: expect.arrayContaining([{ role: 'user', content: 'Hello, I am excited about this role.' }]),
          schema: expect.any(Object),
        }),
      );
      expect(mockedAppSync.triggerAnswerAttempted).toHaveBeenCalledWith({
        sessionId: 'session123',
        questionId: 'question123',
        result: 'Tell me more about your experience',
        state: null,
      });
    });

    it('should complete interview and grade when ready for grading', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Thank you for your time. That concludes our interview.',
            readyForGrading: true,
          },
        },
        responseTimeMs: 1200,
        usage: { totalTokens: 200 },
        reasoning: 'I have gathered sufficient information to make a comprehensive assessment.',
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      await service.generateAssistantResponse(mockQuestion, mockSession);

      expect(mockQuestion.state).toEqual('Completed');
      expect(mockedDynamoDB.putDocument).toHaveBeenCalledWith(mockQuestion);
      expect(mockedAppSync.triggerAnswerAttempted).toHaveBeenCalledWith({
        sessionId: 'session123',
        questionId: 'question123',
        state: 'Completed',
        result: 'Thank you for your time. That concludes our interview.',
      });
    });

    it('should store reasoning with assistant message', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Can you elaborate on your Python experience?',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1000,
        usage: { totalTokens: 120 },
        reasoning: 'Need to verify their Python claims with specific examples.',
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      await service.generateAssistantResponse(mockQuestion, mockSession);

      // Verify the conversation was updated with reasoning
      expect(mockedQuestion.updateConversation).toHaveBeenCalledWith(
        'session123',
        'question123',
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: 'Can you elaborate on your Python experience?',
            reasoning: 'Need to verify their Python claims with specific examples.',
          }),
        ]),
      );
    });

    it('should handle LLM response without reasoning', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'What programming languages do you use?',
            readyForGrading: false,
          },
        },
        responseTimeMs: 800,
        usage: { totalTokens: 100 },
        // No reasoning field
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      await service.generateAssistantResponse(mockQuestion, mockSession);

      expect(mockedQuestion.updateConversation).toHaveBeenCalledWith(
        'session123',
        'question123',
        expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: 'What programming languages do you use?',
            reasoning: undefined,
          }),
        ]),
      );
    });

    it('should initialize empty conversation if null', async () => {
      const questionWithoutConversation = {
        ...mockQuestion,
        conversation: undefined,
      };

      const mockLLMResponse = {
        response: {
          object: {
            message: 'Test response',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1000,
        usage: { totalTokens: 150 },
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      await service.generateAssistantResponse(questionWithoutConversation, mockSession);

      expect(questionWithoutConversation.conversation).toEqual([
        { role: 'assistant', content: 'Test response', reasoning: undefined },
      ]);
    });

    it('should throw error when system prompt is null', async () => {
      mockedReplacePlaceholders.mockReturnValue(null);

      await expect(service.generateAssistantResponse(mockQuestion, mockSession)).rejects.toThrow(
        'System prompt is null',
      );
    });

    it('should handle LLMService failure', async () => {
      const error = new Error('LLM service failed');
      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue(error);

      await expect(service.generateAssistantResponse(mockQuestion, mockSession)).rejects.toThrow('LLM service failed');
    });

    it('should track LLM error when LLMService fails', async () => {
      const error = new Error('LLM service failed');
      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue(error);

      await expect(service.generateAssistantResponse(mockQuestion, mockSession)).rejects.toThrow('LLM service failed');

      expect(mockedObservabilityService.trackLLMError).toHaveBeenCalledWith(
        'group-2',
        '19100000-0000-0000-0000-000000000000',
      );
    });

    it('should not track LLM error when session has no experiment group', async () => {
      const sessionWithoutExperimentGroup = { ...mockSession, experiment_group: undefined };
      const error = new Error('LLM service failed');
      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue(error);

      await expect(service.generateAssistantResponse(mockQuestion, sessionWithoutExperimentGroup)).rejects.toThrow(
        'LLM service failed',
      );

      expect(mockedObservabilityService.trackLLMError).not.toHaveBeenCalled();
    });

    it('should handle LLM error tracking failures gracefully', async () => {
      const originalError = new Error('Original LLM failure');
      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue(originalError);
      mockedObservabilityService.trackLLMError.mockRejectedValueOnce(new Error('Tracking failed'));

      // Should still throw the original error, not the tracking error
      await expect(service.generateAssistantResponse(mockQuestion, mockSession)).rejects.toThrow(
        'Original LLM failure',
      );

      expect(mockedObservabilityService.trackLLMError).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error objects when tracking LLM errors', async () => {
      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockRejectedValue('String error instead of Error object');

      await expect(service.generateAssistantResponse(mockQuestion, mockSession)).rejects.toThrow(
        'String error instead of Error object',
      );

      expect(mockedObservabilityService.trackLLMError).toHaveBeenCalledWith(
        'group-2',
        '19100000-0000-0000-0000-000000000000',
      );
    });

    it('should track LLM performance when experiment group exists', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Test response',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1500,
        usage: { totalTokens: 150 },
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      await service.generateAssistantResponse(mockQuestion, mockSession);

      expect(mockedObservabilityService.trackLLMPerformance).toHaveBeenCalledTimes(1);
      expect(mockedObservabilityService.trackLLMPerformance).toHaveBeenCalledWith(
        'group-2',
        'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
        1500,
        150,
      );
    });

    it('should not track LLM performance when no experiment group', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Test response',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1500,
        usage: { totalTokens: 150 },
      };
      const sessionWithoutExperimentGroup = { ...mockSession, experiment_group: undefined };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      await service.generateAssistantResponse(mockQuestion, sessionWithoutExperimentGroup);

      expect(mockedObservabilityService.trackLLMPerformance).not.toHaveBeenCalled();
    });

    it('should track token usage metrics', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Test response',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1200,
        usage: { totalTokens: 275 },
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      await service.generateAssistantResponse(mockQuestion, mockSession);

      expect(mockedObservabilityService.trackLLMPerformance).toHaveBeenCalledWith(
        'group-2',
        'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
        1200,
        275,
      );
    });

    it('should handle ObservabilityService errors gracefully for all metrics', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Test response',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1000,
        usage: { totalTokens: 150 },
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);
      mockedObservabilityService.trackLLMPerformance.mockRejectedValueOnce(new Error('CloudWatch error'));

      // Should not throw
      await expect(service.generateAssistantResponse(mockQuestion, mockSession)).resolves.not.toThrow();

      expect(mockedObservabilityService.trackLLMPerformance).toHaveBeenCalledTimes(1);
    });
  });

  describe('forceGrading parameter', () => {
    it('should be passed to generateAssistantResponse method', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Test response',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1000,
        usage: { totalTokens: 100 },
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      // Test that forceGrading parameter is accepted (even if not used in current implementation)
      await service.generateAssistantResponse(mockQuestion, mockSession, true);

      expect(mockedLLMService.callWithStructuredOutput).toHaveBeenCalled();
    });
  });

  describe('conversation cleanup', () => {
    it('should call cleanupBedrockConversation', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Test response',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1000,
        usage: { totalTokens: 100 },
      };

      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);

      await service.generateAssistantResponse(mockQuestion, mockSession);

      expect(mockedCleanupBedrockConversation).toHaveBeenCalledWith(mockQuestion.conversation, true);
    });
  });

  describe('error handling edge cases', () => {
    it('should handle AppSync notification failure', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Test response',
            readyForGrading: false,
          },
        },
        responseTimeMs: 1000,
        usage: { totalTokens: 150 },
      };

      const error = new Error('AppSync failed');
      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);
      mockedAppSync.triggerAnswerAttempted.mockRejectedValue(error);

      await expect(service.generateAssistantResponse(mockQuestion, mockSession)).rejects.toThrow('AppSync failed');
    });

    it('should handle DynamoDB save failure during grading', async () => {
      const mockLLMResponse = {
        response: {
          object: {
            message: 'Thank you for your time.',
            readyForGrading: true,
          },
        },
        responseTimeMs: 1000,
        usage: { totalTokens: 150 },
      };

      const error = new Error('DynamoDB save failed');
      mockedReplacePlaceholders.mockReturnValue('System prompt');
      mockedLLMService.callWithStructuredOutput.mockResolvedValue(mockLLMResponse);
      mockedDynamoDB.putDocument.mockRejectedValue(error);

      await expect(service.generateAssistantResponse(mockQuestion, mockSession)).rejects.toThrow(
        'DynamoDB save failed',
      );
    });

    it('should handle R2DocumentFetcher failure', async () => {
      const error = new Error('R2 document fetch failed');
      mockedR2DocumentFetcher.fetch.mockRejectedValue(error);

      await expect(service.generateAssistantResponse(mockQuestion, mockSession)).rejects.toThrow(
        'R2 document fetch failed',
      );
    });
  });
});
