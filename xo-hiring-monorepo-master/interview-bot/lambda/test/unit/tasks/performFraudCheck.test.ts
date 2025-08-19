import { InterviewBotLoggingContext } from '../../../src/common/logger';
import { SessionDocument } from '../../../src/model/session';
import { QuestionDocument } from '../../../src/model/question';
import { Athena } from '@trilogy-group/xoh-integration';
import { normalizeText, performFraudCheck } from '../../../src/tasks/performFraudCheck';
import { Config } from '../../../src/config';

describe('performFraudCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Config.getAthenaDatabaseName = jest.fn().mockReturnValue('');
  });

  test('Should skip fraud check for null or empty answer', async () => {
    // Arrange
    const session = {
      id: 'test-session',
      testTaker: { email: 'test@example.com' },
    } as SessionDocument;
    const question = {
      id: 'test-question',
      gsi1pk: 'QUESTION#test-question',
    } as QuestionDocument;
    const logContext: InterviewBotLoggingContext = {};
    Athena.query = jest.fn();

    // Act
    await performFraudCheck(session, question, '', logContext);

    // Assert
    expect(Athena.query).not.toHaveBeenCalled();
  });

  test('Should perform fraud check and update question with similarity scores', async () => {
    // Arrange
    const session = {
      id: 'test-session',
      testTaker: { email: 'test@example.com' },
    } as SessionDocument;
    const question = {
      id: 'test-question',
      gsi1pk: 'QUESTION#test-question',
    } as QuestionDocument;
    const answer = 'This is a test answer';
    const logContext: InterviewBotLoggingContext = {};

    const mockAthenaResponse = [
      {
        pk: 'SESSION#session1',
        jaccard_similarity: '0.8',
        levenshtein_dist: '2',
        levenshtein_similarity: '0.9',
      },
      {
        pk: 'SESSION#session2',
        jaccard_similarity: '0.7',
        levenshtein_dist: '3',
        levenshtein_similarity: '0.85',
      },
    ];

    Athena.query = jest.fn().mockResolvedValue(mockAthenaResponse);

    // Act
    await performFraudCheck(session, question, answer, logContext);

    // Assert
    expect(Athena.query).toHaveBeenCalledWith(expect.any(String), {
      parameters: [normalizeText(answer), question.gsi1pk, session.testTaker?.email ?? ''],
      database: Config.getAthenaDatabaseName(),
    });

    expect(question.similarityScores).toEqual([
      {
        id: 'session1',
        jaccard: 0.8,
        levenshtein: 0.9,
      },
      {
        id: 'session2',
        jaccard: 0.7,
        levenshtein: 0.85,
      },
    ]);
  });

  test('Should skip fraud check when no similar answers found', async () => {
    // Arrange
    const session = {
      id: 'test-session',
      testTaker: { email: 'test@example.com' },
    } as SessionDocument;
    const question = {
      id: 'test-question',
      gsi1pk: 'QUESTION#test-question',
    } as QuestionDocument;
    const answer = 'This is a test answer';
    const logContext: InterviewBotLoggingContext = {};

    Athena.query = jest.fn().mockResolvedValue([]);

    // Act
    await performFraudCheck(session, question, answer, logContext);

    // Assert
    expect(Athena.query).toHaveBeenCalled();
    expect(question.similarityScores).toBeUndefined();
  });
});
