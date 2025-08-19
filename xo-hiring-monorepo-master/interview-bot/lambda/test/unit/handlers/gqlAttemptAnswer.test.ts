import { handler } from '../../../src/handlers/gqlAttemptAnswer';
import { Sqs } from '../../../src/integrations/sqs';
import { getQuestionKey, Question } from '../../../src/model/question';
import { getSessionKey, Session } from '../../../src/model/session';
import { Skill } from '../../../src/model/skill';

describe('gqlAttemptAnswer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('Should sent sqs message to attempt answer on valid input', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'prompt-engineering',
    });
    Session.getById = jest.fn().mockResolvedValue({
      ...getSessionKey('1'),
      id: '1',
    });
    Question.getById = jest.fn().mockResolvedValue({
      ...getQuestionKey('1', '2'),
      id: '2',
      promptSettings: {
        maxAttempts: 2,
      },
      answerMaxSize: 100,
    });
    Question.updateAnswerAndAttempt = jest.fn();
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      arguments: {
        sessionId: '1',
        questionId: '2',
        answer: 'TEST_ANSWER',
      },
    } as any);

    // Assert
    expect(result).toEqual({
      error: null,
    });
    expect(Question.updateAnswerAndAttempt).toBeCalledWith('1', '2', 'TEST_ANSWER', 1);
    expect(Sqs.sendGptMessage).toBeCalledWith({
      type: 'attempt-user-prompt',
      sessionId: '1',
      questionId: '2',
      prompt: 'TEST_ANSWER',
    });
  });

  test('Should fail on missing session entity', async () => {
    // Arrange
    Session.getById = jest.fn().mockResolvedValue(null);
    Question.getById = jest.fn().mockResolvedValue(null);
    Question.updateAnswerAndAttempt = jest.fn();
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      arguments: {
        sessionId: '1',
        questionId: '2',
        answer: 'TEST_ANSWER',
      },
    } as any);

    // Assert
    expect(result).toEqual({
      error: 'Cannot find specified session or question',
    });
    expect(Question.updateAnswerAndAttempt).toBeCalledTimes(0);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
  });

  test('Should fail on missing question entity', async () => {
    // Arrange
    Session.getById = jest.fn().mockResolvedValue({
      ...getSessionKey('1'),
      id: '1',
    });
    Question.getById = jest.fn().mockResolvedValue(null);
    Question.updateAnswerAndAttempt = jest.fn();
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      arguments: {
        sessionId: '1',
        questionId: '2',
        answer: 'TEST_ANSWER',
      },
    } as any);

    // Assert
    expect(result).toEqual({
      error: 'Cannot find specified session or question',
    });
    expect(Question.updateAnswerAndAttempt).toBeCalledTimes(0);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
  });

  test('Should fail on max attempts reached', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'prompt-engineering',
    });
    Session.getById = jest.fn().mockResolvedValue({
      ...getSessionKey('1'),
      id: '1',
    });
    Question.getById = jest.fn().mockResolvedValue({
      ...getQuestionKey('1', '2'),
      id: '2',
      promptSettings: {
        maxAttempts: 2,
      },
      answerMaxSize: 100,
      answerAttempts: 2,
    });
    Question.updateAnswerAndAttempt = jest.fn();
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      arguments: {
        sessionId: '1',
        questionId: '2',
        answer: 'TEST_ANSWER',
      },
    } as any);

    // Assert
    expect(result).toEqual({
      error: 'Exceeded attempts limit',
    });
    expect(Question.updateAnswerAndAttempt).toBeCalledTimes(0);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
  });

  test('Should fail on empty answer', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'prompt-engineering',
    });
    Session.getById = jest.fn().mockResolvedValue({
      ...getSessionKey('1'),
      id: '1',
    });
    Question.getById = jest.fn().mockResolvedValue({
      ...getQuestionKey('1', '2'),
      id: '2',
      promptSettings: {
        maxAttempts: 2,
      },
      answerMaxSize: 100,
    });
    Question.updateAnswerAndAttempt = jest.fn();
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      arguments: {
        sessionId: '1',
        questionId: '2',
        answer: '',
      },
    } as any);

    // Assert
    expect(result).toEqual({
      error: 'Empty input provided',
    });
    expect(Question.updateAnswerAndAttempt).toBeCalledTimes(0);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
  });

  test('Should fail on answer exceeding length limit', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'prompt-engineering',
    });
    Session.getById = jest.fn().mockResolvedValue({
      ...getSessionKey('1'),
      id: '1',
    });
    Question.getById = jest.fn().mockResolvedValue({
      ...getQuestionKey('1', '2'),
      id: '2',
      promptSettings: {
        maxAttempts: 2,
      },
      answerMaxSize: 3,
    });
    Question.updateAnswerAndAttempt = jest.fn();
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      arguments: {
        sessionId: '1',
        questionId: '2',
        answer: 'TEST_ANSWER',
      },
    } as any);

    // Assert
    expect(result).toEqual({
      error: 'Answer is too long',
    });
    expect(Question.updateAnswerAndAttempt).toBeCalledTimes(0);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
  });

  test('Should allow first empty answer for interview mode', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'interview',
    });
    Session.getById = jest.fn().mockResolvedValue({
      ...getSessionKey('1'),
      id: '1',
    });
    Question.getById = jest.fn().mockResolvedValue({
      ...getQuestionKey('1', '2'),
      id: '2',
    });
    Question.updateConversation = jest.fn();
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      arguments: {
        sessionId: '1',
        questionId: '2',
        answer: '',
      },
    } as any);

    // Assert
    expect(result).toEqual({
      error: null,
    });
    expect(Question.updateConversation).toBeCalledWith('1', '2', [
      {
        content: 'Hi',
        role: 'user',
      },
    ]);
    expect(Sqs.sendGptMessage).toBeCalledWith({
      type: 'interview-user-message',
      sessionId: '1',
      questionId: '2',
    });
  });

  test('Should not allow empty answers for existing conversation in interview mode', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'interview',
    });
    Session.getById = jest.fn().mockResolvedValue({
      ...getSessionKey('1'),
      id: '1',
    });
    Question.getById = jest.fn().mockResolvedValue({
      ...getQuestionKey('1', '2'),
      id: '2',
      conversation: [
        {
          role: 'user',
          content: 'Previous answer',
        },
      ],
    });
    Question.updateConversation = jest.fn();
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      arguments: {
        sessionId: '1',
        questionId: '2',
        answer: '',
      },
    } as any);

    // Assert
    expect(result).toEqual({
      error: 'Empty input provided',
    });
    expect(Question.updateConversation).toBeCalledTimes(0);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
  });

  test('Should update conversation in interview mode', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'interview',
    });
    Session.getById = jest.fn().mockResolvedValue({
      ...getSessionKey('1'),
      id: '1',
    });
    Question.getById = jest.fn().mockResolvedValue({
      ...getQuestionKey('1', '2'),
      id: '2',
    });
    Question.updateConversation = jest.fn();
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      arguments: {
        sessionId: '1',
        questionId: '2',
        answer: 'Hello this is test',
      },
    } as any);

    // Assert
    expect(result).toEqual({
      error: null,
    });
    expect(Question.updateConversation).toBeCalledWith('1', '2', [
      {
        role: 'user',
        content: 'Hello this is test',
      },
    ]);
    expect(Sqs.sendGptMessage).toBeCalledWith({
      type: 'interview-user-message',
      sessionId: '1',
      questionId: '2',
    });
  });
});
