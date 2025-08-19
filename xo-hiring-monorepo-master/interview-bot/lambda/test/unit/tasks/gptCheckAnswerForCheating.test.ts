import { InterviewBotLoggingContext } from '../../../src/common/logger';
import { SessionContextData } from '../../../src/common/session-context';
import { Llm } from '@trilogy-group/xoh-integration';
import { gptCheckAnswerForCheating } from '../../../src/tasks/gptCheckAnswerForCheating';
import { generateObject } from 'ai';
import { LLMProjectName } from '../../../src/config';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

describe('gptCheckAnswerForCheating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Should generate prompt and call LLM', async () => {
    // Arrange
    const sessionContext: SessionContextData = {
      questionGenerator: {
        cheatingPrompt: {
          system: 'system',
          user: 'The rubric is: {{question.cheatingRubric}}',
        },
      },
      question: {
        cheatingRubric: 'rubric',
      },
    } as SessionContextData;
    const logContext: InterviewBotLoggingContext = {};

    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockResolvedValue({
      object: {
        summary: 'test',
        cheated: 'no',
      },
    });

    // Act
    const result = await gptCheckAnswerForCheating(sessionContext, logContext);

    // Assert
    expect(result).toEqual({
      cheatingCheck: {
        summary: 'test',
        cheated: 'no',
      },
      cheatingCheckRegex: undefined,
      overallResult: null,
    });
    expect(Llm.getDefaultModel).toBeCalledWith(LLMProjectName);
    expect(generateObject).toBeCalledWith({
      system: 'system',
      prompt: 'The rubric is: rubric',
      schema: expect.any(Object),
      temperature: 0,
      model: mockModel,
    });
  });

  test('Should return null on missing cheating prompt', async () => {
    // Arrange
    const sessionContext: SessionContextData = {
      questionGenerator: {},
      question: {
        cheatingRubric: 'rubric',
      },
    } as SessionContextData;
    const logContext: InterviewBotLoggingContext = {};
    (generateObject as jest.Mock).mockResolvedValue({});

    // Act
    const result = await gptCheckAnswerForCheating(sessionContext, logContext);

    // Assert
    expect(result).toEqual({
      cheatingCheck: undefined,
      cheatingCheckRegex: undefined,
      overallResult: null,
    });
    expect(generateObject).not.toBeCalled();
  });

  test('Should return null on missing cheating rubric', async () => {
    // Arrange
    const sessionContext: SessionContextData = {
      questionGenerator: {
        cheatingPrompt: {
          system: 'system',
          user: 'The rubric is: {{question.cheatingRubric}}',
        },
      },
      question: {},
    } as SessionContextData;
    const logContext: InterviewBotLoggingContext = {};
    (generateObject as jest.Mock).mockResolvedValue({});

    // Act
    const result = await gptCheckAnswerForCheating(sessionContext, logContext);

    // Assert
    expect(result).toEqual({
      cheatingCheck: undefined,
      cheatingCheckRegex: undefined,
      overallResult: null,
    });
    expect(generateObject).not.toBeCalled();
  });

  test('Should detect cheating based on regex patterns', async () => {
    // Arrange
    const cheatingPatterns = ['copy-pasted-answer', 'plagiarized-section', 'that'];
    const sessionContext: SessionContextData = {
      questionGenerator: {},
      question: {
        cheatingPatterns: cheatingPatterns,
        answer: 'This is a copy-pasted-answer that should be detected.',
      },
    } as SessionContextData;
    const logContext: InterviewBotLoggingContext = {};

    // Act
    const result = await gptCheckAnswerForCheating(sessionContext, logContext);

    // Assert
    expect(result).toEqual({
      cheatingCheck: undefined,
      cheatingCheckRegex: {
        cheated: 'yes',
        summary: `Failed regex patterns: 'copy-pasted-answer', 'that'`,
        checksFailed: 2,
      },
      overallResult: {
        cheated: 'yes',
        summary: 'Cheating detected (regex-based)',
      },
    });
  });
});
