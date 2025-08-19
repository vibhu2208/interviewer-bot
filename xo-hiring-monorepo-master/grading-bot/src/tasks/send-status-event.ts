import axios from 'axios';
import { GradingBotLoggingContext, Logger } from '../common/logger';
import { Config } from '../config';
import { SqsSendGradingEventMessage } from '../integrations/sqs';
import { Ssm } from '../integrations/ssm';
import { StepFunctions } from '../integrations/step-functions';
import { GradingResult, GradingTask, GradingTaskDocument } from '../model/grading-task';

const log = Logger.create('send-status-event');

export async function delayCallbackEvent(
  task: GradingTaskDocument,
  event: EventData,
  forceNoDelay?: boolean,
): Promise<void> {
  const logContext = log.context(task);
  if (task.callbackUrl != null) {
    const config = await Ssm.getForEnvironment();
    const message: SqsSendGradingEventMessage = {
      type: 'send-grading-event',
      taskId: task.id,
      event,
    };
    let delayInSeconds = config.delayGradingEventsForSeconds;
    if (task.forceNoGradingDelay === true || forceNoDelay === true) {
      delayInSeconds = '5';
    }
    log.info(`Delaying grading event for ${delayInSeconds} second`, logContext);
    await StepFunctions.sendDelayedQueueMessage(
      `${task.id}_grading`,
      Config.getTasksQueueUrl(),
      message,
      delayInSeconds,
    );
  } else {
    log.info('callbackUrl is not defined, skipping callback event', logContext);
  }
}

/**
 * Send an error event to the callback (not using the delay)
 * @param task
 * @param message
 */
export async function sendErrorEvent(task: GradingTaskDocument, message: string): Promise<void> {
  const logContext = log.context(task);
  task.gradingError = message;
  task.status = 'GradingError';
  await performStatusEventCallback(
    task.callbackUrl,
    {
      event: 'grading-complete',
      taskId: task.id,
      applicationStepResultId: task.applicationStepResultId,
      error: message,
      grading: [],
    },
    logContext,
  );
}

/**
 * Called from the SQS handler after the delay passed
 * @param message
 */
export async function sendCallbackEvent(message: SqsSendGradingEventMessage): Promise<void> {
  const task = await GradingTask.getByIdOrThrow(message.taskId);
  await GradingTask.fillFromPromptExecutionTasks(task);

  const logContext = log.context(message, task);
  await performStatusEventCallback(
    task.callbackUrl,
    {
      event: message.event.event,
      error: message.event.error,
      taskId: task.id,
      applicationStepResultId: task.applicationStepResultId,
      grading: task.grading ?? [],
    },
    logContext,
  );
}

/**
 * Perform the actual callback
 * @param callbackUrl
 * @param event
 * @param logContext
 */
async function performStatusEventCallback(
  callbackUrl: string | null | undefined,
  event: TaskCallbackEvent,
  logContext?: GradingBotLoggingContext,
): Promise<void> {
  if (callbackUrl != null) {
    // Send grading event
    try {
      log.info(`Sending graded event to callback`, logContext, { event });
      const response = await axios.request({
        url: callbackUrl,
        method: 'POST',
        data: event,
      });
      log.info(`Received response from the callback`, logContext, {
        response: {
          data: response.data,
          status: response.status,
        },
      });
    } catch (e) {
      log.error(`Error while sending grading results back to XO`, e, logContext);

      // Attempt to retry
      throw e;
    }
  }
}

export interface TaskCallbackEvent {
  event: string;
  taskId: string;
  applicationStepResultId: string;
  error?: string;
  grading: GradingResult[];
}

export interface EventData {
  event: string;
  error?: string;
}
