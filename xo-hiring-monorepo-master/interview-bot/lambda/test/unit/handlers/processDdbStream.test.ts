import { ScoreCalculation } from '../../../src/common/score-calculation';
import { Config } from '../../../src/config';
import { handler } from '../../../src/handlers/processDdbStream';
import { DynamoDB } from '../../../src/integrations/dynamodb';
import { Sqs } from '../../../src/integrations/sqs';
import { StepFunctions } from '../../../src/integrations/step-functions';
import { Question } from '../../../src/model/question';
import { getSessionKey, Session, SessionDocument } from '../../../src/model/session';
import { Skill } from '../../../src/model/skill';
import { ABTestingService } from '../../../src/services/ab-testing.service';
import { MatchingInterviewGradingService } from '../../../src/services/matching-interview-grading.service';
import { ObservabilityService } from '../../../src/services/observability.service';

jest.mock('../../../src/services/observability.service');
jest.mock('../../../src/services/ab-testing.service');
jest.mock('../../../src/services/matching-interview-grading.service');

describe('processDdbStream', () => {
  test('Should trigger session grading on state changed to Completed for free-response skill', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Started',
      skillId: '2',
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...sessionDocument,
        state: 'Completed',
      })
      .mockReturnValueOnce({
        // Old Image
        ...sessionDocument,
      });
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'free-response',
    });
    Session.setGradedQuestionsCounter = jest.fn();
    Question.getAllForSession = jest.fn().mockResolvedValue([
      {
        id: '1',
      },
      {
        id: '2',
      },
    ]);
    Sqs.bulkSendGptMessages = jest.fn();

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
        },
      ],
    });

    // Assert
    expect(Session.setGradedQuestionsCounter).toBeCalledWith(sessionDocument.id, 0);
    expect(Question.getAllForSession).toBeCalledWith(sessionDocument.id);
    expect(Sqs.bulkSendGptMessages).toBeCalledWith([
      {
        questionId: '1',
        sessionId: sessionDocument.id,
        type: 'grade-individual-answer',
      },
      {
        questionId: '2',
        sessionId: sessionDocument.id,
        type: 'grade-individual-answer',
      },
    ]);
  });

  test('Should trigger session grading on state changed to Completed for prompt-engineering skill', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Started',
      skillId: '2',
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...sessionDocument,
        state: 'Completed',
      })
      .mockReturnValueOnce({
        // Old Image
        ...sessionDocument,
      });
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'prompt-engineering',
    });
    Session.setGradedQuestionsCounter = jest.fn();
    Question.getAllForSession = jest.fn().mockResolvedValue([
      {
        id: '1',
      },
      {
        id: '2',
      },
    ]);
    Sqs.bulkSendGptMessages = jest.fn();

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
        },
      ],
    });

    // Assert
    expect(Session.setGradedQuestionsCounter).toBeCalledWith(sessionDocument.id, 0);
    expect(Question.getAllForSession).toBeCalledWith(sessionDocument.id);
    expect(Sqs.bulkSendGptMessages).toBeCalledWith([
      {
        questionId: '1',
        sessionId: sessionDocument.id,
        type: 'grade-individual-answer',
      },
      {
        questionId: '2',
        sessionId: sessionDocument.id,
        type: 'grade-individual-answer',
      },
    ]);
  });

  test('Should trigger session event on state changed to Graded', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Graded',
      skillId: '2',
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...sessionDocument,
      })
      .mockReturnValueOnce({
        // Old Image
        ...sessionDocument,
        state: 'Completed',
      });
    Session.sendStatusEvent = jest.fn();

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
        },
      ],
    });

    // Assert
    expect(Session.sendStatusEvent).toBeCalledWith(sessionDocument);
  });

  test('Should grade individual questions when session state changed to Graded', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Completed',
      skillId: '2',
      totalQuestionsCount: 2,
      gradedQuestionsCount: 2,
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...sessionDocument,
      })
      .mockReturnValueOnce({
        // Old Image
        ...sessionDocument,
        gradedQuestionsCount: 1,
      });
    Question.getAllForSession = jest.fn().mockResolvedValue([
      {
        id: '1',
        depthGrading: {
          score: 3,
        },
        correctnessGrading: {
          score: 7,
        },
        status: 'Published',
      },
      {
        id: '2',
        depthGrading: {
          score: 2,
        },
        correctnessGrading: {
          score: 6.1,
        },
        status: 'Published',
      },
      {
        id: '3',
        depthGrading: {
          score: 7,
        },
        correctnessGrading: {
          score: 7,
        },
        status: 'Calibration',
      },
    ]);
    Session.sendStatusEvent = jest.fn();
    Session.setStateToGraded = jest.fn();

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
        },
      ],
    });

    // Assert
    expect(Session.setStateToGraded).toBeCalledWith(
      sessionDocument.id,
      {
        score: 4.525,
        summary: 'Every questions has been graded individually so there is no overall summary',
      },
      true,
    );
  });

  test('Should trigger session expiration SM run when session state changes to Started and session is timeboxed', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Started',
      durationLimit: 10,
      isTimeboxed: true,
      skillId: '2',
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...sessionDocument,
      })
      .mockReturnValueOnce({
        // Old Image
        ...sessionDocument,
        state: 'Ready',
      });
    StepFunctions.sendDelayedQueueMessage = jest.fn();
    Config.getGptQueueUrl = jest.fn().mockReturnValue('https://queue.url');

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
        },
      ],
    });

    // Assert
    expect(StepFunctions.sendDelayedQueueMessage).toBeCalledTimes(1);
    expect((StepFunctions.sendDelayedQueueMessage as jest.Mock).mock.calls[0][1]).toEqual('https://queue.url');
    expect((StepFunctions.sendDelayedQueueMessage as jest.Mock).mock.calls[0][2]).toEqual({
      type: 'check-session-expiration',
      sessionId: sessionDocument.id,
    });
    expect((StepFunctions.sendDelayedQueueMessage as jest.Mock).mock.calls[0][3]).toEqual(660);
  });

  test('Should trigger session expiration SM run when session state changes to Started and session is not timeboxed', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Started',
      durationLimit: 10,
      isTimeboxed: false,
      skillId: '2',
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...sessionDocument,
      })
      .mockReturnValueOnce({
        // Old Image
        ...sessionDocument,
        state: 'Ready',
      });
    StepFunctions.sendDelayedQueueMessage = jest.fn();
    Config.getGptQueueUrl = jest.fn().mockReturnValue('https://queue.url');
    Config.getNonTimeboxedSessionDurationMultiplier = jest.fn().mockReturnValue(3);

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
        },
      ],
    });

    // Assert
    expect(StepFunctions.sendDelayedQueueMessage).toBeCalledTimes(1);
    expect((StepFunctions.sendDelayedQueueMessage as jest.Mock).mock.calls[0][1]).toEqual('https://queue.url');
    expect((StepFunctions.sendDelayedQueueMessage as jest.Mock).mock.calls[0][2]).toEqual({
      type: 'check-session-expiration',
      sessionId: sessionDocument.id,
    });
    expect((StepFunctions.sendDelayedQueueMessage as jest.Mock).mock.calls[0][3]).toEqual(1800);
  });

  test('Should trigger session grading on state changed to Completed for interview skill', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Started',
      skillId: '2',
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...sessionDocument,
        state: 'Completed',
      })
      .mockReturnValueOnce({
        // Old Image
        ...sessionDocument,
      });
    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'interview',
    });
    Session.setGradedQuestionsCounter = jest.fn();
    DynamoDB.putDocuments = jest.fn();
    Question.getAllForSession = jest.fn().mockResolvedValue([
      {
        id: '1',
        correctnessGrading: {
          score: 1,
          summary: 'Yes',
        },
      },
      {
        id: '2',
      },
    ]);
    Sqs.bulkSendGptMessages = jest.fn();
    Session.setStateToGraded = jest.fn();
    Session.sendStatusEvent = jest.fn();

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
        },
      ],
    });

    // Assert
    expect(Session.setGradedQuestionsCounter).toBeCalledTimes(0);
    expect(Question.getAllForSession).toBeCalledWith(sessionDocument.id);
    expect(Sqs.bulkSendGptMessages).toBeCalledTimes(0);
    expect(Session.sendStatusEvent).toHaveBeenCalledTimes(1);
    expect(Session.setStateToGraded).toBeCalledWith(
      '1',
      {
        score: 1,
        summary: 'Every questions has been graded individually so there is no overall summary',
      },
      true,
    );
  });

  test('Should trigger matching interview grading on state changed to Completed for interview skill with matching experiment', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Started',
      skillId: '19100000-0000-0000-0000-000000000000',
      experiment_group: 'group-2',
    };

    const mockQuestion = {
      id: 'question-1',
      correctnessGrading: null,
    };

    const mockGradingResult = {
      finalScore: 8.5,
      grading: {
        role: 'Senior Software Engineer',
        requirements: ['Technical skills', 'Problem solving'],
        scores: { technical: 9, communication: 8 },
      },
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...sessionDocument,
        state: 'Completed',
      })
      .mockReturnValueOnce({
        // Old Image
        ...sessionDocument,
      });

    Skill.getById = jest.fn().mockResolvedValue({
      mode: 'interview',
    });
    ABTestingService.shouldUseMatchingInterview = jest.fn().mockReturnValue(true);
    Question.getAllForSession = jest.fn().mockResolvedValue([mockQuestion]);
    MatchingInterviewGradingService.grade = jest.fn().mockResolvedValue(mockGradingResult);
    DynamoDB.putDocument = jest.fn();
    Session.setStateToGraded = jest.fn();
    Session.sendStatusEvent = jest.fn();

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
        },
      ],
    });

    // Assert
    expect(ABTestingService.shouldUseMatchingInterview).toBeCalledWith(
      'group-2',
      '19100000-0000-0000-0000-000000000000',
    );
    expect(Question.getAllForSession).toBeCalledWith(sessionDocument.id);
    expect(DynamoDB.putDocument).toBeCalledWith({
      id: 'question-1',
      correctnessGrading: {
        score: 8.5,
        summary: JSON.stringify(mockGradingResult.grading),
      },
    });
    expect(Session.sendStatusEvent).toHaveBeenCalledTimes(1);
    expect(Session.setStateToGraded).toBeCalledWith(
      '1',
      {
        score: 8.5,
        summary: 'Every questions has been graded individually so there is no overall summary',
      },
      true,
    );
  });

  test('Should not trigger session grading on Abandoned session', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Started',
      skillId: '2',
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...sessionDocument,
        state: 'Completed',
        error: 'Abandoned',
      })
      .mockReturnValueOnce({
        // Old Image
        ...sessionDocument,
      });
    Session.setStateToGraded = jest.fn();
    Session.sendStatusEventSessionError = jest.fn();

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
        },
      ],
    });

    // Assert
    expect(Session.setStateToGraded).toBeCalledTimes(0);
    expect(Session.sendStatusEventSessionError).toBeCalledTimes(1);
  });

  test('handleGradingDoneForIndividualQuestions should call ScoreCalculation.gradeSession', async () => {
    // Arrange
    const sessionDocument: Partial<SessionDocument> = {
      ...getSessionKey('1'),
      id: '1',
      state: 'Started',
      skillId: '2',
      totalQuestionsCount: 2,
      gradedQuestionsCount: 2,
    };

    const questions = [
      { id: 'q1', status: 'Published', depthGrading: { score: 3 }, correctnessGrading: { score: 4 } },
      { id: 'q2', status: 'Published', depthGrading: { score: 2 }, correctnessGrading: { score: 5 } },
    ];

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce(sessionDocument) // New Image
      .mockReturnValueOnce({ ...sessionDocument, gradedQuestionsCount: 1 }); // Old Image

    Question.getAllForSession = jest.fn().mockResolvedValue(questions);
    Skill.getById = jest.fn().mockResolvedValue({ mode: 'prompt-engineering' });
    ScoreCalculation.gradeSession = jest.fn();

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
        },
      ],
    });

    // Assert
    expect(ScoreCalculation.gradeSession).toHaveBeenCalledWith(
      'Every questions has been graded individually so there is no overall summary',
      {
        session: expect.objectContaining({ id: '1' }),
        skill: expect.objectContaining({ mode: 'prompt-engineering' }),
        questions,
        logContext: expect.anything(),
      },
    );
  });

  describe('ObservabilityService Integration', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('Should track session started when state changes to Started with experiment_group', async () => {
      // Arrange
      const sessionDocument: Partial<SessionDocument> = {
        ...getSessionKey('1'),
        id: '1',
        state: 'Started',
        skillId: 'skill-123',
        experiment_group: 'group-2',
        durationLimit: 10,
        isTimeboxed: true,
      };

      DynamoDB.unmarshall = jest
        .fn()
        .mockReturnValueOnce({
          // New Image
          ...sessionDocument,
        })
        .mockReturnValueOnce({
          // Old Image
          ...sessionDocument,
          state: 'Ready',
        });

      StepFunctions.sendDelayedQueueMessage = jest.fn();
      Config.getGptQueueUrl = jest.fn().mockReturnValue('https://queue.url');
      ObservabilityService.trackSessionStarted = jest.fn();

      // Act
      await handler({
        Records: [
          {
            eventName: 'MODIFY',
          },
        ],
      });

      // Assert
      expect(ObservabilityService.trackSessionStarted).toHaveBeenCalledTimes(1);
      expect(ObservabilityService.trackSessionStarted).toHaveBeenCalledWith('group-2', 'skill-123');
    });

    test('Should not track session started when experiment_group is undefined', async () => {
      // Arrange
      const sessionDocument: Partial<SessionDocument> = {
        ...getSessionKey('1'),
        id: '1',
        state: 'Started',
        skillId: 'skill-123',
        experiment_group: undefined,
        durationLimit: 10,
        isTimeboxed: true,
      };

      DynamoDB.unmarshall = jest
        .fn()
        .mockReturnValueOnce({
          // New Image
          ...sessionDocument,
        })
        .mockReturnValueOnce({
          // Old Image
          ...sessionDocument,
          state: 'Ready',
        });

      StepFunctions.sendDelayedQueueMessage = jest.fn();
      Config.getGptQueueUrl = jest.fn().mockReturnValue('https://queue.url');
      ObservabilityService.trackSessionStarted = jest.fn();

      // Act
      await handler({
        Records: [
          {
            eventName: 'MODIFY',
          },
        ],
      });

      // Assert
      expect(ObservabilityService.trackSessionStarted).not.toHaveBeenCalled();
    });

    test('Should track session completed and duration when state changes to Completed', async () => {
      // Arrange
      const sessionDocument: Partial<SessionDocument> = {
        ...getSessionKey('1'),
        id: '1',
        state: 'Completed',
        skillId: 'skill-456',
        experiment_group: 'group-3',
        startTime: '2023-11-08T08:00:00.000Z',
        endTime: '2023-11-08T08:30:00.000Z',
      };

      DynamoDB.unmarshall = jest
        .fn()
        .mockReturnValueOnce({
          // New Image
          ...sessionDocument,
        })
        .mockReturnValueOnce({
          // Old Image
          ...sessionDocument,
          state: 'Started',
        });

      Skill.getById = jest.fn().mockResolvedValue({
        mode: 'free-response',
      });
      Session.setGradedQuestionsCounter = jest.fn();
      Question.getAllForSession = jest.fn().mockResolvedValue([]);
      Sqs.bulkSendGptMessages = jest.fn();
      Session.sendStatusEvent = jest.fn();
      ObservabilityService.trackSessionCompleted = jest.fn();
      ObservabilityService.trackSessionDuration = jest.fn();

      // Act
      await handler({
        Records: [
          {
            eventName: 'MODIFY',
          },
        ],
      });

      // Assert
      expect(ObservabilityService.trackSessionCompleted).toHaveBeenCalledTimes(1);
      expect(ObservabilityService.trackSessionCompleted).toHaveBeenCalledWith('group-3', 'skill-456');
      expect(ObservabilityService.trackSessionDuration).toHaveBeenCalledTimes(1);
      expect(ObservabilityService.trackSessionDuration).toHaveBeenCalledWith('group-3', 'skill-456', 1800000); // 30 minutes in ms
    });

    test('Should track session completed without duration when timestamps are missing', async () => {
      // Arrange
      const sessionDocument: Partial<SessionDocument> = {
        ...getSessionKey('1'),
        id: '1',
        state: 'Completed',
        skillId: 'skill-789',
        experiment_group: 'group-1',
        // Missing startTime and endTime
      };

      DynamoDB.unmarshall = jest
        .fn()
        .mockReturnValueOnce({
          // New Image
          ...sessionDocument,
        })
        .mockReturnValueOnce({
          // Old Image
          ...sessionDocument,
          state: 'Started',
        });

      Skill.getById = jest.fn().mockResolvedValue({
        mode: 'free-response',
      });
      Session.setGradedQuestionsCounter = jest.fn();
      Question.getAllForSession = jest.fn().mockResolvedValue([]);
      Sqs.bulkSendGptMessages = jest.fn();
      Session.sendStatusEvent = jest.fn();
      ObservabilityService.trackSessionCompleted = jest.fn();
      ObservabilityService.trackSessionDuration = jest.fn();

      // Act
      await handler({
        Records: [
          {
            eventName: 'MODIFY',
          },
        ],
      });

      // Assert
      expect(ObservabilityService.trackSessionCompleted).toHaveBeenCalledTimes(1);
      expect(ObservabilityService.trackSessionCompleted).toHaveBeenCalledWith('group-1', 'skill-789');
      expect(ObservabilityService.trackSessionDuration).not.toHaveBeenCalled();
    });

    test('Should track session graded when state changes to Graded', async () => {
      // Arrange
      const sessionDocument: Partial<SessionDocument> = {
        ...getSessionKey('1'),
        id: '1',
        state: 'Graded',
        skillId: 'skill-999',
        experiment_group: 'group-4',
        grading: {
          score: 7.5,
          summary: 'Good performance',
        },
      };

      DynamoDB.unmarshall = jest
        .fn()
        .mockReturnValueOnce({
          // New Image
          ...sessionDocument,
        })
        .mockReturnValueOnce({
          // Old Image
          ...sessionDocument,
          state: 'Completed',
        });

      Session.sendStatusEvent = jest.fn();
      ObservabilityService.trackSessionGraded = jest.fn();

      // Act
      await handler({
        Records: [
          {
            eventName: 'MODIFY',
          },
        ],
      });

      // Assert
      expect(ObservabilityService.trackSessionGraded).toHaveBeenCalledTimes(1);
      expect(ObservabilityService.trackSessionGraded).toHaveBeenCalledWith('group-4', 'skill-999');
    });

    test('Should not track session completed for abandoned sessions', async () => {
      // Arrange
      const sessionDocument: Partial<SessionDocument> = {
        ...getSessionKey('1'),
        id: '1',
        state: 'Completed',
        skillId: 'skill-abandoned',
        experiment_group: 'group-2',
        error: 'Abandoned',
      };

      DynamoDB.unmarshall = jest
        .fn()
        .mockReturnValueOnce({
          // New Image
          ...sessionDocument,
        })
        .mockReturnValueOnce({
          // Old Image
          ...sessionDocument,
          state: 'Started',
        });

      Session.sendStatusEventSessionError = jest.fn();
      ObservabilityService.trackSessionCompleted = jest.fn();
      ObservabilityService.trackSessionDuration = jest.fn();

      // Act
      await handler({
        Records: [
          {
            eventName: 'MODIFY',
          },
        ],
      });

      // Assert
      expect(ObservabilityService.trackSessionCompleted).not.toHaveBeenCalled();
      expect(ObservabilityService.trackSessionDuration).not.toHaveBeenCalled();
    });
  });
});
