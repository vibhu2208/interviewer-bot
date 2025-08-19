jest.mock('../../../src/tasks/gptCheckAnswerForCheating');
jest.mock('../../../src/tasks/performFraudCheck');
jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));
import { SessionContext } from '../../../src/common/session-context';
import { DynamoDB } from '../../../src/integrations/dynamodb';
import { Llm } from '@trilogy-group/xoh-integration';
import { Question } from '../../../src/model/question';
import { Session } from '../../../src/model/session';
import { gptGradeIndividualAnswer } from '../../../src/tasks/gptGradeIndividualAnswer';
import * as cheatingTask from '../../../src/tasks/gptCheckAnswerForCheating';
import * as fraudCheckTask from '../../../src/tasks/performFraudCheck';
import { generateObject } from 'ai';

describe('gptGradeIndividualAnswer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Should grade answer using LLM', async () => {
    // Arrange
    SessionContext.fetch = jest.fn().mockResolvedValue({
      session: {
        state: 'Completed',
      },
      questionGenerator: {
        gradingPrompt: {
          system: 'ChatGPT, as an expert technical interviewer you are grading answers',
          user: 'THE QUESTIONS YOU ASKED:\n{{question.question}}\n\nCANDIDATE ANSWERS:\n{{question.answer}}',
        },
      },
    });
    Question.getById = jest.fn().mockResolvedValue({
      index: 0,
      question: 'q1?',
      answer: 'a1',
    });

    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockResolvedValue({
      object: {
        index: 0,
        correctness: 2.34,
        correctnessGrading: 'correctness',
        depth: 6.534,
        depthGrading: 'depth',
      },
    });

    DynamoDB.putDocument = jest.fn();
    Session.incrementGradedQuestionsCounter = jest.fn();

    jest.spyOn(fraudCheckTask, 'performFraudCheck').mockResolvedValue();
    jest.spyOn(cheatingTask, 'gptCheckAnswerForCheating').mockResolvedValue({
      cheatingCheck: {
        summary: 'Sample cheating check',
        cheated: 'no',
      },
      overallResult: null, // Assuming no cheating was detected overall
    });

    // Act
    await gptGradeIndividualAnswer({
      type: 'grade-individual-answer',
      sessionId: '1',
      questionId: '2',
    });

    // Assert
    expect(SessionContext.fetch).toBeCalledWith('1', false);
    expect(Question.getById).toBeCalledWith('1', '2');
    expect(generateObject).toBeCalledWith(
      expect.objectContaining({
        model: mockModel,
        system: 'ChatGPT, as an expert technical interviewer you are grading answers',
        prompt: 'THE QUESTIONS YOU ASKED:\nq1?\n\nCANDIDATE ANSWERS:\na1',
      }),
    );
    expect(DynamoDB.putDocument).toBeCalledWith({
      answer: 'a1',
      correctnessGrading: {
        score: 2.34,
        summary: 'correctness',
      },
      depthGrading: {
        score: 6.534,
        summary: 'depth',
      },
      index: 0,
      question: 'q1?',
      cheatingCheck: {
        summary: 'Sample cheating check',
        cheated: 'no',
      },
    });
    expect(Session.incrementGradedQuestionsCounter).toBeCalledWith('1');
  });

  test('Should not grade answer if cheating detected', async () => {
    // Arrange
    SessionContext.fetch = jest.fn().mockResolvedValue({
      session: {
        state: 'Completed',
      },
      questionGenerator: {
        gradingPrompt: {
          system: 'ChatGPT, as an expert technical interviewer you are grading answers',
          user: 'THE QUESTIONS YOU ASKED:\n{{question.question}}\n\nCANDIDATE ANSWERS:\n{{question.answer}}',
        },
      },
    });
    Question.getById = jest.fn().mockResolvedValue({
      index: 0,
      question: 'q1?',
      answer: 'a1',
    });
    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockResolvedValue({
      object: {
        index: 0,
        correctness: 2.34,
        correctnessGrading: 'correctness',
        depth: 6.534,
        depthGrading: 'depth',
      },
    });
    DynamoDB.putDocument = jest.fn();
    Session.incrementGradedQuestionsCounter = jest.fn();
    jest.spyOn(fraudCheckTask, 'performFraudCheck').mockResolvedValue();
    jest.spyOn(cheatingTask, 'gptCheckAnswerForCheating').mockResolvedValue({
      cheatingCheck: {
        summary: 'Bad cheater',
        cheated: 'yes',
      },
      overallResult: {
        summary: 'Bad cheater',
        cheated: 'yes',
      }, // Reflecting that cheating was detected overall
    });

    // Act
    await gptGradeIndividualAnswer({
      type: 'grade-individual-answer',
      sessionId: '1',
      questionId: '2',
    });

    // Assert
    expect(SessionContext.fetch).toBeCalledWith('1', false);
    expect(Question.getById).toBeCalledWith('1', '2');
    expect(generateObject).toBeCalledTimes(0);
    expect(DynamoDB.putDocument).toBeCalledWith({
      answer: 'a1',
      index: 0,
      question: 'q1?',
      cheatingCheck: {
        summary: 'Bad cheater',
        cheated: 'yes',
      },
      correctnessGrading: {
        score: 0,
        summary: 'Bad cheater',
      },
      cheatingCheckRegex: undefined,
    });
    expect(Session.incrementGradedQuestionsCounter).toBeCalledWith('1');
  });
});
