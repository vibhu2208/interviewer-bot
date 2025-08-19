import axios from 'axios';
import { Config } from '../../src/config';
import { SqsSendGradingEventMessage } from '../../src/integrations/sqs';
import { Ssm } from '../../src/integrations/ssm';
import { StepFunctions } from '../../src/integrations/step-functions';
import { GradingTask } from '../../src/model/grading-task';
import { delayCallbackEvent, sendCallbackEvent } from '../../src/tasks/send-status-event';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('send-status-event', () => {
  it('should delay the callback event if a callback URL is provided', async () => {
    // Arrange
    const task = GradingTask.newDocument({
      status: 'Graded',
      rules: [],
      applicationStepResultId: 'asr-1',
      applicationStepId: 'app-step-1',
      callbackUrl: 'https://example.com/callback',
    });
    const config = { delayGradingEventsForSeconds: '30' };
    Ssm.getForEnvironment = jest.fn().mockResolvedValue(config);
    StepFunctions.sendDelayedQueueMessage = jest.fn();
    Config.getTasksQueueUrl = jest.fn().mockReturnValue('arn::sqs');

    // Act
    await delayCallbackEvent(task, {
      event: 'grading-complete',
    });

    // Assert
    expect(Ssm.getForEnvironment).toHaveBeenCalled();
    expect(StepFunctions.sendDelayedQueueMessage).toHaveBeenCalledWith(
      `${task.id}_grading`,
      expect.any(String),
      expect.objectContaining({ type: 'send-grading-event', taskId: task.id, event: { event: 'grading-complete' } }),
      config.delayGradingEventsForSeconds,
    );
  });
});

describe('sendCallbackEvent', () => {
  it('should send the callback event if a callback URL and grading event are provided', async () => {
    // Arrange
    const task = GradingTask.newDocument({
      status: 'Graded',
      rules: [],
      applicationStepResultId: 'asr-1',
      applicationStepId: 'app-step-1',
      callbackUrl: 'https://example.com/callback',
      grading: [],
    });
    GradingTask.getByIdOrThrow = jest.fn().mockResolvedValue(task);
    GradingTask.fillFromPromptExecutionTasks = jest.fn().mockResolvedValue(task);
    mockedAxios.request.mockResolvedValue({ data: 'success', status: 200 });

    const message: SqsSendGradingEventMessage = {
      type: 'send-grading-event',
      taskId: task.id,
      event: {
        event: 'grading-complete',
      },
    };

    // Act
    await sendCallbackEvent(message);

    // Assert
    expect(GradingTask.getByIdOrThrow).toHaveBeenCalledWith(task.id);
    expect(GradingTask.fillFromPromptExecutionTasks).toHaveBeenCalledTimes(1);
    expect(mockedAxios.request).toHaveBeenCalledWith({
      url: task.callbackUrl,
      method: 'POST',
      data: {
        applicationStepResultId: task.applicationStepResultId,
        event: 'grading-complete',
        error: undefined,
        grading: [],
        taskId: task.id,
      },
    });
  });
});
