import { Llm } from '@trilogy-group/xoh-integration';
import { generateText, tool, ToolSet } from 'ai';
import { AppSync } from '../../../src/integrations/appsync';
import { DynamoDB } from '../../../src/integrations/dynamodb';
import { CalibratedQuestion } from '../../../src/model/calibrated-question';
import { Question } from '../../../src/model/question';
import { Session } from '../../../src/model/session';
import { gptInterviewUserMessage } from '../../../src/tasks/gptInterviewUserMessage';
import { LLMProjectName } from '../../../src/config';

jest.mock('ai', () => ({
  generateText: jest.fn(),
  tool: jest.fn(),
}));

describe('gptInterviewUserMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Should request LLM with the whole conversation', async () => {
    // Arrange
    Session.getById = jest.fn().mockResolvedValue({
      id: '1',
      skillId: '3',
    });
    Question.getById = jest.fn().mockResolvedValue({
      id: '2',
      conversation: [
        {
          role: 'assistant',
          content: 'What did you sell to others?',
        },
        {
          role: 'user',
          content: 'Ive sold a pen for $100000',
        },
      ],
    });
    CalibratedQuestion.getById = jest.fn().mockResolvedValue({
      id: '2',
      interviewPrompt: `You are an interviewer, you ask questions about sales`,
    });

    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateText as jest.Mock).mockResolvedValue({
      text: 'You next question is this one',
      toolCalls: [],
    });

    AppSync.triggerAnswerAttempted = jest.fn();
    Question.updateConversation = jest.fn();

    // Act
    await gptInterviewUserMessage({
      type: 'interview-user-message',
      questionId: '2',
      sessionId: '1',
    });

    // Assert
    expect(Question.getById).toBeCalledWith('1', '2', true);
    expect(Llm.getDefaultModel).toBeCalledWith(LLMProjectName);
    expect(generateText).toBeCalledWith({
      messages: [
        {
          role: 'system',
          content:
            "You are an interviewer, you ask questions about sales\n\nIMPORTANT: If you are ready to grade the candidate, ALWAYS invoke the 'grade' tool instead of returning the JSON! Never output JSON grading as a text!",
        },
        {
          role: 'user',
          content: 'Hi!',
        },
        {
          role: 'assistant',
          content: 'What did you sell to others?',
        },
        {
          role: 'user',
          content: 'Ive sold a pen for $100000',
        },
      ],
      tools: expect.any(Object),
      toolChoice: 'auto',
      temperature: 0,
      model: mockModel,
    });
    expect(Question.updateConversation).toBeCalledWith('1', '2', [
      {
        role: 'user',
        content: 'Hi!',
      },
      {
        role: 'assistant',
        content: 'What did you sell to others?',
      },
      {
        role: 'user',
        content: 'Ive sold a pen for $100000',
      },
      {
        role: 'assistant',
        content: 'You next question is this one',
      },
    ]);
    expect(AppSync.triggerAnswerAttempted).toBeCalledWith({
      questionId: '2',
      sessionId: '1',
      result: 'You next question is this one',
    });
  });

  test('Should correctly process grading function result', async () => {
    // Arrange
    Session.getById = jest.fn().mockResolvedValue({
      id: '1',
      skillId: '3',
    });
    Question.getById = jest.fn().mockResolvedValue({
      id: '2',
      conversation: [
        {
          role: 'assistant',
          content: 'What did you sell to others?',
        },
        {
          role: 'user',
          content: 'Ive sold a pen for $100000',
        },
      ],
    });
    CalibratedQuestion.getById = jest.fn().mockResolvedValue({
      id: '2',
      interviewPrompt: `You are an interviewer, you ask questions about sales`,
    });

    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateText as jest.Mock).mockResolvedValue({
      text: 'Additional non-function output',
      toolCalls: [
        {
          toolName: 'grade',
          args: {
            profile_fit_summary: 'candidate is good',
            profile_fit_rating: 8.5,
          },
        },
      ],
    });

    AppSync.triggerAnswerAttempted = jest.fn();
    Question.updateConversation = jest.fn();
    DynamoDB.putDocument = jest.fn();
    Session.incrementGradedQuestionsCounter = jest.fn();

    // Act
    await gptInterviewUserMessage({
      type: 'interview-user-message',
      questionId: '2',
      sessionId: '1',
    });

    // Assert
    expect(Question.getById).toBeCalledWith('1', '2', true);
    expect(Llm.getDefaultModel).toBeCalledWith(LLMProjectName);
    expect(generateText).toBeCalledWith({
      messages: [
        {
          role: 'system',
          content:
            "You are an interviewer, you ask questions about sales\n\nIMPORTANT: If you are ready to grade the candidate, ALWAYS invoke the 'grade' tool instead of returning the JSON! Never output JSON grading as a text!",
        },
        {
          role: 'user',
          content: 'Hi!',
        },
        {
          role: 'assistant',
          content: 'What did you sell to others?',
        },
        {
          role: 'user',
          content: 'Ive sold a pen for $100000',
        },
      ],
      tools: expect.any(Object),
      toolChoice: 'auto',
      temperature: 0,
      model: mockModel,
    });
    expect(Question.updateConversation).toBeCalledTimes(0);
    expect(DynamoDB.putDocument).toBeCalledWith({
      id: '2',
      conversation: [
        {
          role: 'user',
          content: 'Hi!',
        },
        {
          role: 'assistant',
          content: 'What did you sell to others?',
        },
        {
          role: 'user',
          content: 'Ive sold a pen for $100000',
        },
      ],
      correctnessGrading: {
        score: 8.5,
        summary: 'candidate is good',
      },
      promptResult: 'Additional non-function output',
      state: 'Completed',
    });
    expect(Session.incrementGradedQuestionsCounter).toBeCalledTimes(0);
    expect(AppSync.triggerAnswerAttempted).toBeCalledWith({
      questionId: '2',
      sessionId: '1',
      result: '',
      state: 'Completed',
    });
  });

  test('Should correctly process grading function result with dimensions', async () => {
    // Arrange
    Session.getById = jest.fn().mockResolvedValue({
      id: '1',
      skillId: '3',
    });
    Question.getById = jest.fn().mockResolvedValue({
      id: '2',
      conversation: [
        {
          role: 'assistant',
          content: 'Did you use AI?',
        },
        {
          role: 'user',
          content: 'Yes I did',
        },
      ],
      dimensions: [
        {
          name: 'Practical Applicability',
          levels: 3,
        },
        {
          name: 'Prompt Writing',
          levels: 3,
        },
        {
          name: 'AI Tools Usage',
          levels: 4,
        },
      ],
    });
    CalibratedQuestion.getById = jest.fn().mockResolvedValue({
      id: '2',
      interviewPrompt: `You are an interviewer, you ask questions about AI usage`,
    });

    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateText as jest.Mock).mockResolvedValue({
      text: 'Additional non-function output',
      toolCalls: [
        {
          toolName: 'gradeWithDimensions',
          args: {
            dimensions: [
              {
                name: 'Practical Applicability',
                level: 3,
                summary: 'Very good',
              },
              {
                name: 'Prompt Writing',
                level: 1,
                summary: 'Bad',
              },
              {
                name: 'AI Tools Usage',
                level: 2,
                summary: 'Can be improved',
              },
            ],
          },
        },
      ],
    });

    AppSync.triggerAnswerAttempted = jest.fn();
    Question.updateConversation = jest.fn();
    DynamoDB.putDocument = jest.fn();
    Session.incrementGradedQuestionsCounter = jest.fn();

    // Act
    await gptInterviewUserMessage({
      type: 'interview-user-message',
      questionId: '2',
      sessionId: '1',
    });

    // Assert
    expect(Question.getById).toBeCalledWith('1', '2', true);
    expect(Llm.getDefaultModel).toBeCalledWith(LLMProjectName);
    expect(generateText).toBeCalledWith({
      messages: [
        {
          role: 'system',
          content:
            "You are an interviewer, you ask questions about AI usage\n\nIMPORTANT: If you are ready to grade the candidate, ALWAYS invoke the 'grade' tool instead of returning the JSON! Never output JSON grading as a text!",
        },
        {
          role: 'user',
          content: 'Hi!',
        },
        {
          role: 'assistant',
          content: 'Did you use AI?',
        },
        {
          role: 'user',
          content: 'Yes I did',
        },
      ],
      tools: expect.any(Object),
      toolChoice: 'auto',
      temperature: 0,
      model: mockModel,
    });
    expect(Question.updateConversation).toBeCalledTimes(0);
    expect(DynamoDB.putDocument).toBeCalledWith(
      expect.objectContaining({
        id: '2',
        dimensionsGrading: [
          {
            name: 'Practical Applicability',
            level: 3,
            summary: 'Very good',
          },
          {
            name: 'Prompt Writing',
            level: 1,
            summary: 'Bad',
          },
          {
            name: 'AI Tools Usage',
            level: 2,
            summary: 'Can be improved',
          },
        ],
        correctnessGrading: {
          score: expect.any(Number),
          summary: 'Each dimension has been graded individually so there is no overall summary',
        },
        promptResult: 'Additional non-function output',
        state: 'Completed',
      }),
    );
    expect(Session.incrementGradedQuestionsCounter).toBeCalledTimes(0);
    expect(AppSync.triggerAnswerAttempted).toBeCalledWith({
      questionId: '2',
      sessionId: '1',
      result: '',
      state: 'Completed',
    });
  });
});
