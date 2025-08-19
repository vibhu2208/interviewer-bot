import { NonRetryableError } from '../../../src/common/non-retryable-error';
import { SessionContext } from '../../../src/common/session-context';
import { DynamoDB } from '../../../src/integrations/dynamodb';
import { Llm } from '@trilogy-group/xoh-integration';
import { Session } from '../../../src/model/session';
import { gptPrepareQuestionsForSession } from '../../../src/tasks/gptPrepareQuestionsForSession';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));
import { generateObject } from 'ai';

describe('gptPrepareQuestionsForSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Should pick questions for session and update session state', async () => {
    // Arrange
    SessionContext.fetch = jest.fn().mockResolvedValue({
      questionGenerator: {
        selectorPrompt: {
          system: 'ChatGPT, as an expert technical interviewer you need to select questions',
          user: 'QUESTIONS_COUNT = {{skill.questionsPerSession}}\n\n\nAVAILABLE QUESTIONS:\n{{#each calibratedQuestions}}\nQuestion {{@index}} ({{level}}). {{question}}\n{{/each}}',
        },
      },
      skill: {
        questionsPerSession: 1,
      },
      calibratedQuestions: [
        {
          question: 'q1?',
          level: 'Easy',
          status: 'Review',
        },
        {
          question: 'q2?',
          level: 'Typical',
          status: 'Published',
        },
        {
          question: 'q3?',
          level: 'Difficult',
          status: 'Retired',
        },
        {
          question: 'q4?',
          level: 'Typical',
          status: 'Published',
        },
      ],
    });
    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockResolvedValue({
      object: {
        selectedQuestions: [0],
      },
    });
    DynamoDB.putDocuments = jest.fn();
    Session.setStateToReady = jest.fn();

    // Act
    await gptPrepareQuestionsForSession({
      type: 'prepare-session',
      sessionId: '1',
    });

    // Assert
    expect(SessionContext.fetch).toBeCalledWith('1', false, true);
    expect(generateObject).toBeCalledWith(
      expect.objectContaining({
        model: mockModel,
        system: 'ChatGPT, as an expert technical interviewer you need to select questions',
        prompt: 'QUESTIONS_COUNT = 1\n\n\nAVAILABLE QUESTIONS:\nQuestion 0 (Typical). q2?\nQuestion 1 (Typical). q4?\n',
      }),
    );
    expect(DynamoDB.putDocuments).toBeCalledTimes(1);
    const ddbDocuments = (DynamoDB.putDocuments as jest.Mock).mock.calls[0][0];
    expect(ddbDocuments).toHaveLength(1);
    expect(Session.setStateToReady).toBeCalledWith('1', 1);
  });

  it('should return questions directly if we have exactly the required amount of calibrated questions', async () => {
    // Arrange
    SessionContext.fetch = jest.fn().mockResolvedValue({
      sessionId: '1',
      skill: {
        questionsPerSession: 1,
      },
      calibratedQuestions: [
        {
          id: 'q1',
          question: 'q1?',
          level: 'Easy',
          status: 'Review',
        },
        {
          id: 'q2',
          question: 'q2?',
          level: 'Typical',
          status: 'Published',
        },
      ],
      questionGenerator: {
        selectorPrompt: {
          system: 'system prompt',
          user: 'user prompt',
        },
      },
    });
    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockResolvedValue({
      object: {
        selectedQuestions: [0],
      },
    });
    DynamoDB.putDocuments = jest.fn();
    Session.setStateToReady = jest.fn();

    // Act
    await gptPrepareQuestionsForSession({
      type: 'prepare-session',
      sessionId: '1',
    });

    // Assert
    expect(generateObject).toHaveBeenCalledTimes(0);
    expect(DynamoDB.putDocuments).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'q2' })]));
  });

  it('should throw error if GPT returned less than required amount of questions', async () => {
    // Arrange
    SessionContext.fetch = jest.fn().mockResolvedValue({
      sessionId: '1',
      skill: {
        questionsPerSession: 2,
      },
      calibratedQuestions: [
        {
          question: 'q2?',
          level: 'Typical',
          status: 'Published',
        },
        {
          question: 'q3?',
          level: 'Typical',
          status: 'Published',
        },
        {
          question: 'q4?',
          level: 'Typical',
          status: 'Published',
        },
      ],
      questionGenerator: {
        selectorPrompt: {
          system: 'system prompt',
          user: 'user prompt',
        },
      },
    });
    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockResolvedValue({
      object: {
        selectedQuestions: [0],
      },
    });
    DynamoDB.putDocuments = jest.fn();
    Session.setError = jest.fn();

    // Act
    await expect(() =>
      gptPrepareQuestionsForSession({
        type: 'prepare-session',
        sessionId: '1',
      }),
    ).rejects.toThrow(new Error('GPT did not return the expected number of questions'));

    // Assert
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(DynamoDB.putDocuments).toHaveBeenCalledTimes(0);
    expect(Session.setError).toHaveBeenCalledTimes(0);
  });

  it('should throw non-retryable error if GPT returned less than required amount of questions with 3 retries', async () => {
    // Arrange
    SessionContext.fetch = jest.fn().mockResolvedValue({
      sessionId: '1',
      session: {
        id: '1',
      },
      skill: {
        questionsPerSession: 2,
      },
      calibratedQuestions: [
        {
          question: 'q2?',
          level: 'Typical',
          status: 'Published',
        },
        {
          question: 'q3?',
          level: 'Typical',
          status: 'Published',
        },
        {
          question: 'q4?',
          level: 'Typical',
          status: 'Published',
        },
      ],
      questionGenerator: {
        selectorPrompt: {
          system: 'system prompt',
          user: 'user prompt',
        },
      },
    });
    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockRejectedValueOnce(
      new Error('GPT did not return the expected number of questions'),
    );
    DynamoDB.putDocuments = jest.fn();
    Session.setError = jest.fn();

    // Act
    await expect(() =>
      gptPrepareQuestionsForSession({
        type: 'prepare-session',
        sessionId: '1',
        errors: [
          '1: GPT did not return the expected number of questions',
          '2: GPT did not return the expected number of questions',
          '3: GPT did not return the expected number of questions',
        ],
      }),
    ).rejects.toThrow(new NonRetryableError('GPT did not return the expected number of questions'));

    // Assert
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(DynamoDB.putDocuments).toHaveBeenCalledTimes(0);
    expect(Session.setError).toHaveBeenCalledTimes(1);
  });
});
