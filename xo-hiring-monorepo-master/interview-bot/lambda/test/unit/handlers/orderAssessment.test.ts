import { Config } from '../../../src/config';
import { handler, OrderAssessmentRequest, OrderAssessmentResponse } from '../../../src/handlers/orderAssessment';
import { DynamoDB } from '../../../src/integrations/dynamodb';
import { Sqs } from '../../../src/integrations/sqs';
import { CalibratedQuestion, CalibratedQuestionDocument } from '../../../src/model/calibrated-question';
import { ExperimentGroup } from '../../../src/model/session';
import { getSessionKey } from '../../../src/model/session';
import { Skill } from '../../../src/model/skill';
import { ABTestingService } from '../../../src/services/ab-testing.service';
import { ObservabilityService } from '../../../src/services/observability.service';

// Mock the ABTestingService
jest.mock('../../../src/services/ab-testing.service');
const mockABTestingService = ABTestingService as jest.Mocked<typeof ABTestingService>;

// Mock the ObservabilityService
jest.mock('../../../src/services/observability.service');
const mockObservabilityService = ObservabilityService as jest.Mocked<typeof ObservabilityService>;

describe('orderAssessment', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Default mock for ABTestingService
    mockABTestingService.determineExperimentGroup.mockReturnValue(ExperimentGroup.Group1);

    // Default mock for ObservabilityService
    mockObservabilityService.trackSessionCreated.mockResolvedValue();
  });

  test('Should send sqs message to prepare session on valid input', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      id: '1',
      name: 'Test Skill',
      questionsPerSession: 2,
    });
    CalibratedQuestion.getAllForSkill = jest.fn().mockResolvedValue([
      {
        status: 'Review',
      },
      {
        status: 'Failed Review',
      },
      {
        status: 'Calibration',
      },
      {
        status: 'Failed Calibration',
      },
      {
        status: 'Published',
      },
      {
        status: 'Retired',
      },
    ] as CalibratedQuestionDocument[]);
    DynamoDB.putDocument = jest.fn();
    Sqs.triggerPrepareSession = jest.fn();
    Config.getFrontendUrl = jest.fn().mockReturnValue('https://test.com');

    // Act
    const result = await handler({
      body: JSON.stringify({
        test_id: '1',
        callback_url: 'https://callback.com/9',
        candidate: {
          first_name: 'A',
          last_name: 'B',
          country: 'C',
          email: 'test@example.com',
        },
        order_id: '9',
        redirect_url: 'https://redirect.com',
        duration: 60,
        timeboxed: true,
      } as OrderAssessmentRequest),
    } as any);

    // Assert
    const sessionId = (DynamoDB.putDocument as jest.Mock).mock?.calls?.[0]?.[0]?.id;

    expect(result.statusCode).toBe(201);
    expect(Skill.getById).toBeCalledWith('1');
    expect(CalibratedQuestion.getAllForSkill).toBeCalledWith('1');
    expect(sessionId).toBeDefined();
    expect(DynamoDB.putDocument).toBeCalledWith(
      expect.objectContaining({
        ...getSessionKey(sessionId),
        externalCallbackUrl: 'https://callback.com/9',
        externalOrderId: '9',
        id: sessionId,
        skillId: '1',
        state: 'Initializing',
        durationLimit: 60,
        isTimeboxed: true,
        testTaker: {
          email: 'test@example.com',
          name: 'A B',
        },
        experiment_group: ExperimentGroup.Group1,
      }),
    );
    const response: OrderAssessmentResponse = JSON.parse(result.body);
    expect(response).toEqual(
      expect.objectContaining({
        assessment_id: sessionId,
        assessment_url: `https://test.com/landing?sessionId=${sessionId}`,
      }),
    );
    expect(response.assessment_result_url).toBeDefined();
    expect(Sqs.triggerPrepareSession).toBeCalledWith(sessionId);
    expect(mockABTestingService.determineExperimentGroup).toHaveBeenCalledWith(undefined);
  });

  test('Should set experiment group based on test group and skill', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      id: 'pilot-skill-id',
      name: 'Pilot Skill',
      questionsPerSession: 2,
    });
    CalibratedQuestion.getAllForSkill = jest
      .fn()
      .mockResolvedValue([{ status: 'Published' }, { status: 'Published' }] as CalibratedQuestionDocument[]);
    DynamoDB.putDocument = jest.fn();
    Sqs.triggerPrepareSession = jest.fn();
    Config.getFrontendUrl = jest.fn().mockReturnValue('https://test.com');

    // Mock ABTestingService to return matching-interview experiment group
    mockABTestingService.determineExperimentGroup.mockReturnValue(ExperimentGroup.Group2);

    // Act
    const result = await handler({
      body: JSON.stringify({
        test_id: 'pilot-skill-id',
        callback_url: 'https://callback.com/test',
        candidate: {
          first_name: 'Test',
          last_name: 'User',
          country: 'US',
          email: 'test@example.com',
          test_group: '1',
        },
        order_id: 'test-order',
        duration: 120,
        timeboxed: false,
      } as OrderAssessmentRequest),
    } as any);

    // Assert
    const sessionId = (DynamoDB.putDocument as jest.Mock).mock?.calls?.[0]?.[0]?.id;

    expect(result.statusCode).toBe(201);
    expect(mockABTestingService.determineExperimentGroup).toHaveBeenCalledWith('1');
    expect(DynamoDB.putDocument).toBeCalledWith(
      expect.objectContaining({
        experiment_group: ExperimentGroup.Group2,
        skillId: 'pilot-skill-id',
        durationLimit: 120,
        isTimeboxed: false,
      }),
    );
  });

  test('Should handle missing test group', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      id: 'regular-skill-id',
      name: 'Regular Skill',
      questionsPerSession: 1,
    });
    CalibratedQuestion.getAllForSkill = jest
      .fn()
      .mockResolvedValue([{ status: 'Published' }] as CalibratedQuestionDocument[]);
    DynamoDB.putDocument = jest.fn();
    Sqs.triggerPrepareSession = jest.fn();
    Config.getFrontendUrl = jest.fn().mockReturnValue('https://test.com');

    // Act
    const result = await handler({
      body: JSON.stringify({
        test_id: 'regular-skill-id',
        callback_url: 'https://callback.com/test',
        candidate: {
          first_name: 'Test',
          last_name: 'User',
          country: 'US',
          email: 'test@example.com',
          // No test_group provided
        },
        order_id: 'test-order',
      } as OrderAssessmentRequest),
    } as any);

    // Assert
    expect(result.statusCode).toBe(201);
    expect(mockABTestingService.determineExperimentGroup).toHaveBeenCalledWith(undefined);
    expect(DynamoDB.putDocument).toBeCalledWith(
      expect.objectContaining({
        experiment_group: ExperimentGroup.Group1,
      }),
    );
  });

  test('Should handle different test group values', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      id: 'test-skill',
      name: 'Test Skill',
      questionsPerSession: 1,
    });
    CalibratedQuestion.getAllForSkill = jest
      .fn()
      .mockResolvedValue([{ status: 'Published' }] as CalibratedQuestionDocument[]);
    DynamoDB.putDocument = jest.fn();
    Sqs.triggerPrepareSession = jest.fn();
    Config.getFrontendUrl = jest.fn().mockReturnValue('https://test.com');

    // Act
    await handler({
      body: JSON.stringify({
        test_id: 'test-skill',
        callback_url: 'https://callback.com/test',
        candidate: {
          first_name: 'Test',
          last_name: 'User',
          country: 'US',
          email: 'test@example.com',
          test_group: '2',
        },
        order_id: 'test-order',
      } as OrderAssessmentRequest),
    } as any);

    // Assert
    expect(mockABTestingService.determineExperimentGroup).toHaveBeenCalledWith('2');
  });

  test('Should fail on invalid skill id', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue(null);
    DynamoDB.putDocument = jest.fn();
    Sqs.triggerPrepareSession = jest.fn();

    // Act
    const result = await handler({
      body: JSON.stringify({
        test_id: '1',
        callback_url: 'https://callback.com/9',
        candidate: {
          first_name: 'A',
          last_name: 'B',
          country: 'C',
          email: 'test@example.com',
          test_group: '1',
          candidate_id: 'C123',
        },
        order_id: '9',
        redirect_url: 'https://redirect.com',
        duration: 60,
        timeboxed: true,
        pipeline_id: 'P123',
      } as OrderAssessmentRequest),
    } as any);

    // Assert
    expect(result.statusCode).toBe(404);
    expect(Skill.getById).toBeCalledWith('1');
    expect(DynamoDB.putDocument).toBeCalledTimes(0);
    expect(Sqs.triggerPrepareSession).toBeCalledTimes(0);
  });

  test('Should fail on low amount of calibrated questions', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      id: '1',
      name: 'Test Skill',
      questionsPerSession: 3,
    });
    CalibratedQuestion.getAllForSkill = jest.fn().mockResolvedValue([
      {
        status: 'Review',
      },
      {
        status: 'Failed Review',
      },
      {
        status: 'Calibration',
      },
      {
        status: 'Failed Calibration',
      },
      {
        status: 'Published',
      },
      {
        status: 'Retired',
      },
    ] as CalibratedQuestionDocument[]);
    DynamoDB.putDocument = jest.fn();
    Sqs.triggerPrepareSession = jest.fn();

    // Act
    const result = await handler({
      body: JSON.stringify({
        test_id: '1',
        callback_url: 'https://callback.com/9',
        candidate: {
          first_name: 'A',
          last_name: 'B',
          country: 'C',
          email: 'test@example.com',
        },
        order_id: '9',
        redirect_url: 'https://redirect.com',
        duration: 60,
        timeboxed: true,
      } as OrderAssessmentRequest),
    } as any);

    // Assert
    expect(result.statusCode).toBe(400);
    expect(Skill.getById).toBeCalledWith('1');
    expect(DynamoDB.putDocument).toBeCalledTimes(0);
    expect(Sqs.triggerPrepareSession).toBeCalledTimes(0);
    expect(JSON.parse(result.body)).toEqual({
      error: `Not enough calibrated questions in the valid status (2) for skill 'Test Skill'`,
    });
  });

  describe('ObservabilityService Integration', () => {
    test('Should track session created when assessment is successfully ordered with experiment group', async () => {
      // Arrange
      Skill.getById = jest.fn().mockResolvedValue({
        id: 'skill-123',
        name: 'Test Skill',
        questionsPerSession: 2,
      });
      CalibratedQuestion.getAllForSkill = jest
        .fn()
        .mockResolvedValue([{ status: 'Published' }, { status: 'Published' }] as CalibratedQuestionDocument[]);
      DynamoDB.putDocument = jest.fn();
      Sqs.triggerPrepareSession = jest.fn();
      Config.getFrontendUrl = jest.fn().mockReturnValue('https://test.com');

      // Mock ABTestingService to return group-2
      mockABTestingService.determineExperimentGroup.mockReturnValue(ExperimentGroup.Group2);

      // Act
      const result = await handler({
        body: JSON.stringify({
          test_id: 'skill-123',
          callback_url: 'https://callback.com/test',
          candidate: {
            first_name: 'Test',
            last_name: 'User',
            country: 'US',
            email: 'test@example.com',
            test_group: '3',
          },
          order_id: 'order-456',
        } as OrderAssessmentRequest),
      } as any);

      // Assert
      expect(result.statusCode).toBe(201);
      expect(mockObservabilityService.trackSessionCreated).toHaveBeenCalledTimes(1);
      expect(mockObservabilityService.trackSessionCreated).toHaveBeenCalledWith('group-2', 'skill-123');
    });

    test('Should track session created with Group1 when no test group provided', async () => {
      // Arrange
      Skill.getById = jest.fn().mockResolvedValue({
        id: 'skill-456',
        name: 'Another Skill',
        questionsPerSession: 1,
      });
      CalibratedQuestion.getAllForSkill = jest
        .fn()
        .mockResolvedValue([{ status: 'Published' }] as CalibratedQuestionDocument[]);
      DynamoDB.putDocument = jest.fn();
      Sqs.triggerPrepareSession = jest.fn();
      Config.getFrontendUrl = jest.fn().mockReturnValue('https://test.com');

      // Default ABTestingService returns Group1
      mockABTestingService.determineExperimentGroup.mockReturnValue(ExperimentGroup.Group1);

      // Act
      const result = await handler({
        body: JSON.stringify({
          test_id: 'skill-456',
          callback_url: 'https://callback.com/test',
          candidate: {
            first_name: 'Test',
            last_name: 'User',
            country: 'US',
            email: 'test@example.com',
            // No test_group provided
          },
          order_id: 'order-789',
        } as OrderAssessmentRequest),
      } as any);

      // Assert
      expect(result.statusCode).toBe(201);
      expect(mockObservabilityService.trackSessionCreated).toHaveBeenCalledTimes(1);
      expect(mockObservabilityService.trackSessionCreated).toHaveBeenCalledWith('group-1', 'skill-456');
    });

    test('Should not track session created when skill is not found', async () => {
      // Arrange
      Skill.getById = jest.fn().mockResolvedValue(null);

      // Act
      const result = await handler({
        body: JSON.stringify({
          test_id: 'nonexistent-skill',
          callback_url: 'https://callback.com/test',
          candidate: {
            first_name: 'Test',
            last_name: 'User',
            country: 'US',
            email: 'test@example.com',
          },
          order_id: 'order-fail',
        } as OrderAssessmentRequest),
      } as any);

      // Assert
      expect(result.statusCode).toBe(404);
      expect(mockObservabilityService.trackSessionCreated).not.toHaveBeenCalled();
    });

    test('Should not track session created when not enough calibrated questions', async () => {
      // Arrange
      Skill.getById = jest.fn().mockResolvedValue({
        id: 'skill-insufficient',
        name: 'Insufficient Questions Skill',
        questionsPerSession: 5,
      });
      CalibratedQuestion.getAllForSkill = jest.fn().mockResolvedValue([
        { status: 'Published' },
        { status: 'Draft' }, // Not valid
      ] as CalibratedQuestionDocument[]);

      // Act
      const result = await handler({
        body: JSON.stringify({
          test_id: 'skill-insufficient',
          callback_url: 'https://callback.com/test',
          candidate: {
            first_name: 'Test',
            last_name: 'User',
            country: 'US',
            email: 'test@example.com',
          },
          order_id: 'order-insufficient',
        } as OrderAssessmentRequest),
      } as any);

      // Assert
      expect(result.statusCode).toBe(400);
      expect(mockObservabilityService.trackSessionCreated).not.toHaveBeenCalled();
    });

    test('Should handle ObservabilityService errors gracefully', async () => {
      // Arrange
      Skill.getById = jest.fn().mockResolvedValue({
        id: 'skill-error-test',
        name: 'Error Test Skill',
        questionsPerSession: 1,
      });
      CalibratedQuestion.getAllForSkill = jest
        .fn()
        .mockResolvedValue([{ status: 'Published' }] as CalibratedQuestionDocument[]);
      DynamoDB.putDocument = jest.fn();
      Sqs.triggerPrepareSession = jest.fn();
      Config.getFrontendUrl = jest.fn().mockReturnValue('https://test.com');

      // Mock ObservabilityService to throw an error
      mockObservabilityService.trackSessionCreated.mockRejectedValueOnce(new Error('CloudWatch error'));

      // Act & Assert - Should not throw, handler should complete successfully
      const result = await handler({
        body: JSON.stringify({
          test_id: 'skill-error-test',
          callback_url: 'https://callback.com/test',
          candidate: {
            first_name: 'Test',
            last_name: 'User',
            country: 'US',
            email: 'test@example.com',
          },
          order_id: 'order-error-test',
        } as OrderAssessmentRequest),
      } as any);

      // The handler should still succeed even if ObservabilityService fails
      expect(result.statusCode).toBe(201);
      expect(mockObservabilityService.trackSessionCreated).toHaveBeenCalledTimes(1);
    });
  });
});
