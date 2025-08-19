import { Config } from '../../../src/config';
import { Crossover } from '../../../src/integrations/crossover';
import { Sqs } from '../../../src/integrations/sqs';
import { Ssm } from '../../../src/integrations/ssm';
import { StepFunctions } from '../../../src/integrations/step-functions';
import { Question } from '../../../src/model/question';
import { Session } from '../../../src/model/session';

describe('Sending session-related events', () => {
  test('Should not generate session event if externalCallback is not defined', async () => {
    // Arrange
    const document = {
      externalCallbackUrl: null,
    } as any;
    Crossover.generateStatusEvent = jest.fn();

    // Act
    await Session.sendStatusEvent(document);

    // Assert
    expect(Crossover.generateStatusEvent).toBeCalledTimes(0);
  });

  // Session state, Event, Delay, Should invoke Step Function, Should invoke SQS
  const matrix: any[] = [
    ['Initializing', null, 0, false, false],
    ['Ready', null, 0, false, false],
    ['Started', null, 0, false, false],
    ['Completed', 'short', 0, false, true],
    ['Graded', 'full', 0, false, true],
    ['Completed', 'short', 60, false, true],
    ['Graded', 'full', 60, true, false],
  ];

  const shortEvent = {
    status: 'submitted',
    assessment: {
      assessment_id: 'cd7c6acd-8630-4fd0-b8ee-cd78d0a29a0a',
      submission_time: '2023-11-08T08:28:28',
      duration: '00:00:04',
    },
  };
  const fullEvent = {
    status: 'completed',
    results_url: 'https://sandbox-assessments.crossover.com/result',
    assessment: {
      assessment_id: 'cd7c6acd-8630-4fd0-b8ee-cd78d0a29a0a',
      score: '5',
      summary: 'Yes',
      submission_time: '2023-11-08T08:28:28',
      duration: '00:00:04',
    },
  };

  test.each(matrix)(
    'given state %p, event %p, delay %p, should invoke step fn: %p, invoke sqs: %p',
    async (state: string, event: 'full' | 'short' | null, delay: number, invokeStep: boolean, invokeSQS: boolean) => {
      // Arrange
      const document = {
        id: 'cd7c6acd-8630-4fd0-b8ee-cd78d0a29a0a',
        externalCallbackUrl: 'https://example.com/callback',
        state: state,
      } as any;
      let statusEventPayload;
      switch (event) {
        case 'full':
          statusEventPayload = fullEvent;
          break;
        case 'short':
          statusEventPayload = shortEvent;
          break;
        default:
          statusEventPayload = null;
      }
      Question.getAllForSession = jest.fn().mockResolvedValue([]);
      Crossover.generateStatusEvent = jest.fn().mockReturnValue(statusEventPayload);
      Ssm.getForEnvironment = jest.fn().mockResolvedValue({
        delayGradingEventsForSeconds: delay,
      });
      StepFunctions.sendDelayedQueueMessage = jest.fn();
      Sqs.sendStatusEventMessage = jest.fn();
      Config.getStatusEventQueueUrl = jest.fn().mockReturnValue('https://sqs/test');

      // Act
      await Session.sendStatusEvent(document);

      // Assert
      expect(StepFunctions.sendDelayedQueueMessage).toBeCalledTimes(invokeStep ? 1 : 0);
      if (invokeStep) {
        expect((StepFunctions.sendDelayedQueueMessage as jest.Mock).mock.calls[0][2]).toEqual({
          type: 'status-event',
          sessionId: 'cd7c6acd-8630-4fd0-b8ee-cd78d0a29a0a',
          callbackUrl: 'https://example.com/callback',
          payload: statusEventPayload,
        });
        expect((StepFunctions.sendDelayedQueueMessage as jest.Mock).mock.calls[0][3]).toEqual(delay);
      }
      expect(Sqs.sendStatusEventMessage).toBeCalledTimes(invokeSQS ? 1 : 0);
      if (invokeSQS) {
        expect((Sqs.sendStatusEventMessage as jest.Mock).mock.calls[0][0]).toEqual({
          type: 'status-event',
          sessionId: document.id,
          callbackUrl: document.externalCallbackUrl,
          payload: statusEventPayload,
        });
      }
    },
  );

  test('should not delay status event when score is above the threshold', async () => {
    // Arrange
    const document = {
      id: 'cd7c6acd-8630-4fd0-b8ee-cd78d0a29a0a',
      externalCallbackUrl: 'https://example.com/callback',
      state: 'Graded',
      noDelayIfScoreAbove: 7,
      grading: {
        score: 8,
      },
    } as any;

    const statusEventPayload = fullEvent;

    Question.getAllForSession = jest.fn().mockResolvedValue([]);
    Crossover.generateStatusEvent = jest.fn().mockReturnValue(statusEventPayload);
    Ssm.getForEnvironment = jest.fn().mockResolvedValue({
      delayGradingEventsForSeconds: 60,
    });
    StepFunctions.sendDelayedQueueMessage = jest.fn();
    Sqs.sendStatusEventMessage = jest.fn();
    Config.getStatusEventQueueUrl = jest.fn().mockReturnValue('https://sqs/test');

    // Act
    await Session.sendStatusEvent(document);

    // Assert
    expect(StepFunctions.sendDelayedQueueMessage).not.toBeCalled();
    expect(Sqs.sendStatusEventMessage).toBeCalledTimes(1);
    expect(Sqs.sendStatusEventMessage).toBeCalledWith({
      type: 'status-event',
      sessionId: document.id,
      callbackUrl: document.externalCallbackUrl,
      payload: statusEventPayload,
    });
  });

  test('should delay status event when score is below the threshold', async () => {
    // Arrange
    const document = {
      id: 'cd7c6acd-8630-4fd0-b8ee-cd78d0a29a0a',
      externalCallbackUrl: 'https://example.com/callback',
      state: 'Graded',
      noDelayIfScoreAbove: 7,
      grading: {
        score: 6,
      },
    } as any;

    const statusEventPayload = fullEvent;

    Question.getAllForSession = jest.fn().mockResolvedValue([]);
    Crossover.generateStatusEvent = jest.fn().mockReturnValue(statusEventPayload);
    Ssm.getForEnvironment = jest.fn().mockResolvedValue({
      delayGradingEventsForSeconds: 60,
    });
    StepFunctions.sendDelayedQueueMessage = jest.fn();
    Sqs.sendStatusEventMessage = jest.fn();
    Config.getStatusEventQueueUrl = jest.fn().mockReturnValue('https://sqs/test');

    // Act
    await Session.sendStatusEvent(document);

    // Assert
    expect(StepFunctions.sendDelayedQueueMessage).toBeCalledTimes(1);
    expect(StepFunctions.sendDelayedQueueMessage).toBeCalledWith(
      expect.any(String),
      'https://sqs/test',
      {
        type: 'status-event',
        sessionId: document.id,
        callbackUrl: document.externalCallbackUrl,
        payload: statusEventPayload,
      },
      60,
    );
    expect(Sqs.sendStatusEventMessage).not.toBeCalled();
  });
});
