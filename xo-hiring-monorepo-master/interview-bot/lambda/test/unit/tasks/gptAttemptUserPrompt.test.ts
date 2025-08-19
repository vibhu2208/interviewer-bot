import { SessionContext } from '../../../src/common/session-context';
import { AppSync } from '../../../src/integrations/appsync';
import { Question } from '../../../src/model/question';
import { gptAttemptUserPrompt } from '../../../src/tasks/gptAttemptUserPrompt';
import { gptCheckAnswerForCheating } from '../../../src/tasks/gptCheckAnswerForCheating';
import { DEFAULT_LLM_DEFINITION, Llm } from '@trilogy-group/xoh-integration';
import { generateObject } from 'ai';

jest.mock('../../../src/tasks/gptCheckAnswerForCheating', () => ({
  gptCheckAnswerForCheating: jest.fn(),
}));

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

describe('gptAttemptUserPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Should evaluate prompt using LLM', async () => {
    // Arrange
    Question.getById = jest.fn().mockResolvedValue({
      promptSettings: {
        model: 'test-model',
      },
      answerAttempts: 1,
    });

    const mockModel = {};
    Llm.getModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockResolvedValue({
      object: {
        response: 'Eval Result',
      },
    });

    Question.updatePromptResult = jest.fn();
    AppSync.triggerAnswerAttempted = jest.fn();
    SessionContext.fetch = jest.fn().mockResolvedValue({});

    // Mock the gptCheckAnswerForCheating to return a non-cheating result
    (gptCheckAnswerForCheating as jest.Mock).mockResolvedValue({
      overallResult: { cheated: 'no' },
    });

    // Act
    await gptAttemptUserPrompt({
      type: 'attempt-user-prompt',
      questionId: '2',
      sessionId: '1',
      prompt: 'eval this',
    });

    // Assert
    expect(Question.getById).toBeCalledWith('1', '2');
    expect(Llm.getModel).toBeCalled();
    expect(generateObject).toBeCalledWith({
      prompt: 'eval this',
      schema: expect.any(Object),
      temperature: 0,
      model: mockModel,
    });
    expect(Question.updatePromptResult).toBeCalledWith('1', '2', 'Eval Result');
    expect(AppSync.triggerAnswerAttempted).toBeCalledTimes(1);
    expect(AppSync.triggerAnswerAttempted).toBeCalledWith({
      attempts: 1,
      questionId: '2',
      sessionId: '1',
      result: 'Eval Result',
      validAnswer: true,
    });
  });

  test('Should trigger AppSync on error', async () => {
    // Arrange
    Question.getById = jest.fn().mockResolvedValue({
      answerAttempts: 1,
      promptSettings: {
        model: DEFAULT_LLM_DEFINITION.model,
      },
    });
    const error = new Error('Test Error');
    const mockModel = {};
    Llm.getModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockRejectedValue(error);
    Question.updatePromptResult = jest.fn();
    AppSync.triggerAnswerAttempted = jest.fn();

    expect.assertions(5);

    // Act
    try {
      await gptAttemptUserPrompt({
        type: 'attempt-user-prompt',
        questionId: '2',
        sessionId: '1',
        prompt: 'eval this',
      });
    } catch (e) {
      expect(e).toBe(error);
    }

    // Assert
    expect(Question.getById).toBeCalledWith('1', '2');
    expect(Question.updatePromptResult).toBeCalledTimes(0);
    expect(AppSync.triggerAnswerAttempted).toBeCalledTimes(1);
    expect(AppSync.triggerAnswerAttempted).toBeCalledWith({
      questionId: '2',
      sessionId: '1',
      error: 'Test Error',
    });
  });

  test('Should handle cheating result properly', async () => {
    // Arrange
    Question.getById = jest.fn().mockResolvedValue({
      promptSettings: {
        model: 'test-model',
      },
      answerAttempts: 1,
    });

    const mockModel = {};
    Llm.getModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockResolvedValue({
      object: {
        response: 'Eval Result',
      },
    });

    Question.updatePromptResult = jest.fn();
    AppSync.triggerAnswerAttempted = jest.fn();
    SessionContext.fetch = jest.fn().mockResolvedValue({});

    // Mock cheating detection
    (gptCheckAnswerForCheating as jest.Mock).mockResolvedValue({
      overallResult: { cheated: 'yes', summary: 'Detected cheating' },
    });

    // Act
    await gptAttemptUserPrompt({
      type: 'attempt-user-prompt',
      questionId: '2',
      sessionId: '1',
      prompt: 'eval this',
    });

    // Assert
    expect(AppSync.triggerAnswerAttempted).toBeCalledWith({
      attempts: 1,
      questionId: '2',
      sessionId: '1',
      result: 'Eval Result',
      validAnswer: false,
    });
  });
});
