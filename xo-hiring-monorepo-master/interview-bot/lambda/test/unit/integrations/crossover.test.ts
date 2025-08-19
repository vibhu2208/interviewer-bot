import { Config } from '../../../src/config';
import { Crossover, formatTime } from '../../../src/integrations/crossover';
import { QuestionDocument } from '../../../src/model/question';
import { Session } from '../../../src/model/session';

describe('crossover', () => {
  test('Should generate session completed event', async () => {
    // Arrange
    const session = Session.newDocument({
      state: 'Completed',
      startTime: '2023-09-05T01:01:01.000Z',
      endTime: '2023-09-05T01:01:41.000Z',
      secretKey: '123456',
      skillId: '2',
      durationLimit: 120,
      isTimeboxed: true,
      externalOrderId: '3',
      testTaker: {
        name: 'A',
        email: 'test@example.com',
      },
    });

    const questions: QuestionDocument[] = [];
    Config.getFrontendUrl = jest.fn().mockReturnValue('https://frontend.com');

    // Act
    const result = Crossover.generateStatusEvent(session, questions);

    // Assert
    expect(result).toEqual({
      assessment: {
        assessment_id: session.id,
        duration: '00:00:40',
        submission_time: '2023-09-05T01:01:01',
      },
      status: 'submitted',
    });
  });

  test('Should generate session graded event', async () => {
    // Arrange
    const session = Session.newDocument({
      state: 'Graded',
      startTime: '2023-09-05T01:01:01.000Z',
      endTime: '2023-09-05T01:01:41.000Z',
      secretKey: '123456',
      skillId: '2',
      durationLimit: 120,
      isTimeboxed: true,
      externalOrderId: '3',
      testTaker: {
        name: 'A',
        email: 'test@example.com',
      },
      grading: {
        score: 3.4545,
        summary: 'Sample Grading',
      },
    });

    const questions: QuestionDocument[] = [
      {
        id: '1',
        correctnessGrading: {
          score: 3.234,
          summary: 'a',
        },
        depthGrading: {
          score: 4.433,
          summary: 'b',
        },
        answer: 'answer1',
      } as QuestionDocument,
    ];
    Config.getFrontendUrl = jest.fn().mockReturnValue('https://frontend.com');

    // Act
    const result = Crossover.generateStatusEvent(session, questions);

    // Assert
    expect(result).toEqual({
      assessment: {
        assessment_id: session.id,
        details: {
          main: {
            score: '35',
            1: {
              candidate_response: 'answer1',
              score: '38',
            },
          },
        },
        duration: '00:00:40',
        score: '35',
        submission_time: '2023-09-05T01:01:01',
        summary: 'Sample Grading',
      },
      results_url: `https://frontend.com/grading-report?sessionId=${session.id}&detailed=true&secretKey=123456`,
      status: 'completed',
    });
  });

  test('Should properly handle time conversion', async () => {
    const t12h = formatTime('2023-10-17T06:33:23.198Z');
    const t24h = formatTime('2023-10-17T13:41:23.198Z');

    expect(t12h).toEqual('2023-10-17T06:33:23');
    expect(t24h).toEqual('2023-10-17T13:41:23');
  });

  describe('fraud check', () => {
    // LAMBDA-83811: Skip till behavior is restored
    test.skip('Should generate fraud check event with definite fraud', async () => {
      // Arrange
      const session = Session.newDocument({
        state: 'Graded',
        startTime: '2023-09-05T01:01:01.000Z',
        endTime: '2023-09-05T01:01:41.000Z',
        secretKey: '123456',
        skillId: '2',
        durationLimit: 120,
        isTimeboxed: true,
        externalOrderId: '3',
        testTaker: {
          name: 'A',
          email: 'test@example.com',
        },
        grading: {
          score: 3.4545,
          summary: 'Sample Grading',
        },
      });

      const questions: QuestionDocument[] = [
        {
          id: '1',
          correctnessGrading: {
            score: 3.234,
            summary: 'a',
          },
          depthGrading: {
            score: 4.433,
            summary: 'b',
          },
          answer: 'answer1',
          similarityScores: [
            {
              id: 'session-123',
              levenshtein: 0.995,
              jaccard: 0.8,
            },
          ],
        } as QuestionDocument,
      ];
      Config.getFrontendUrl = jest.fn().mockReturnValue('https://frontend.com');

      // Act
      const result = Crossover.generateStatusEvent(session, questions);

      // Assert
      expect(result?.assessment.fraud_check).toEqual({
        confidence: 1,
        description: `Similar Submissions:
Submission ID: session-123
- Question ID: 1
- Levenshtein Similarity: 0.99
- Jaccard Similarity: 0.80`,
      });
    });

    test('Should generate fraud check event with potential fraud', async () => {
      // Arrange
      const session = Session.newDocument({
        state: 'Graded',
        startTime: '2023-09-05T01:01:01.000Z',
        endTime: '2023-09-05T01:01:41.000Z',
        secretKey: '123456',
        skillId: '2',
        durationLimit: 120,
        isTimeboxed: true,
        externalOrderId: '3',
        testTaker: {
          name: 'A',
          email: 'test@example.com',
        },
        grading: {
          score: 3.4545,
          summary: 'Sample Grading',
        },
      });

      const questions: QuestionDocument[] = [
        {
          id: '1',
          correctnessGrading: {
            score: 3.234,
            summary: 'a',
          },
          depthGrading: {
            score: 4.433,
            summary: 'b',
          },
          answer: 'answer1',
          similarityScores: [
            {
              id: 'session-123',
              levenshtein: 0.95,
              jaccard: 0.7,
            },
          ],
        } as QuestionDocument,
      ];
      Config.getFrontendUrl = jest.fn().mockReturnValue('https://frontend.com');

      // Act
      const result = Crossover.generateStatusEvent(session, questions);

      // Assert
      expect(result?.assessment.fraud_check).toEqual({
        confidence: 0,
        description: `Similar Submissions:
Submission ID: session-123
- Question ID: 1
- Levenshtein Similarity: 0.95
- Jaccard Similarity: 0.70`,
      });
    });

    test('Should not generate fraud check event when no similar submissions found', async () => {
      // Arrange
      const session = Session.newDocument({
        state: 'Graded',
        startTime: '2023-09-05T01:01:01.000Z',
        endTime: '2023-09-05T01:01:41.000Z',
        secretKey: '123456',
        skillId: '2',
        durationLimit: 120,
        isTimeboxed: true,
        externalOrderId: '3',
        testTaker: {
          name: 'A',
          email: 'test@example.com',
        },
        grading: {
          score: 3.4545,
          summary: 'Sample Grading',
        },
      });

      const questions: QuestionDocument[] = [
        {
          id: '1',
          correctnessGrading: {
            score: 3.234,
            summary: 'a',
          },
          depthGrading: {
            score: 4.433,
            summary: 'b',
          },
          answer: 'answer1',
          similarityScores: [
            {
              id: 'session-123',
              levenshtein: 0.85,
              jaccard: 0.5,
            },
          ],
        } as QuestionDocument,
      ];
      Config.getFrontendUrl = jest.fn().mockReturnValue('https://frontend.com');

      // Act
      const result = Crossover.generateStatusEvent(session, questions);

      // Assert
      expect(result?.assessment.fraud_check).toBeUndefined();
    });

    // LAMBDA-83811: Skip till behavior is restored
    test.skip('Should merge multiple similar submissions into a single fraud check', async () => {
      // Arrange
      const session = Session.newDocument({
        state: 'Graded',
        startTime: '2023-09-05T01:01:01.000Z',
        endTime: '2023-09-05T01:01:41.000Z',
        secretKey: '123456',
        skillId: '2',
        durationLimit: 120,
        isTimeboxed: true,
        externalOrderId: '3',
        testTaker: {
          name: 'A',
          email: 'test@example.com',
        },
        grading: {
          score: 3.4545,
          summary: 'Sample Grading',
        },
      });

      const questions: QuestionDocument[] = [
        {
          id: '1',
          correctnessGrading: {
            score: 3.234,
            summary: 'a',
          },
          depthGrading: {
            score: 4.433,
            summary: 'b',
          },
          answer: 'answer1',
          similarityScores: [
            {
              id: 'session-123',
              levenshtein: 0.995,
              jaccard: 0.8,
            },
          ],
        } as QuestionDocument,
        {
          id: '2',
          correctnessGrading: {
            score: 3.234,
            summary: 'a',
          },
          depthGrading: {
            score: 4.433,
            summary: 'b',
          },
          answer: 'answer2',
          similarityScores: [
            {
              id: 'session-456',
              levenshtein: 0.95,
              jaccard: 0.7,
            },
          ],
        } as QuestionDocument,
      ];
      Config.getFrontendUrl = jest.fn().mockReturnValue('https://frontend.com');

      // Act
      const result = Crossover.generateStatusEvent(session, questions);

      // Assert
      expect(result?.assessment.fraud_check).toEqual({
        confidence: 1,
        description: `Similar Submissions:
Submission ID: session-123
- Question ID: 1
- Levenshtein Similarity: 0.99
- Jaccard Similarity: 0.80

Submission ID: session-456
- Question ID: 2
- Levenshtein Similarity: 0.95
- Jaccard Similarity: 0.70`,
      });
    });
  });
});
