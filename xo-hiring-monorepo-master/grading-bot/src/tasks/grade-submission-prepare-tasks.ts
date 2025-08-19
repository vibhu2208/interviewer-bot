import { GradingBotLoggingContext, Logger } from '../common/logger';
import { NonRetryableError } from '../common/non-retryable-error';
import { Config } from '../config';
import { DynamoDB } from '../integrations/dynamodb';
import { Sqs, SqsGradeTaskMessage } from '../integrations/sqs';
import { GradingBotSsmConfig } from '../integrations/ssm';
import { GradingBatch } from '../model/grading-batch';
import { GradingTask, GradingTaskDocument } from '../model/grading-task';
import { PromptExecutionTaskDocument } from '../model/prompt-execution-task';
import { prepareSMResponsesPrompt } from '../processors/sm-response';
import { prepareStructuredTablePrompt } from '../processors/table-sections-google-doc';
import { prepareDefaultPrompt } from '../processors/unstructured-google-doc';
import { delayCallbackEvent } from './send-status-event';

const log = Logger.create('grade-submissions-pt');

export async function gradeSubmissionPrepareTasks(
  message: SqsGradeTaskMessage,
  config: GradingBotSsmConfig,
): Promise<void> {
  const task = await GradingTask.getByIdOrThrow(message.taskId);
  const logContext = log.context(message, task);

  try {
    log.info(`Preparing prompts for grading mode: ${task.gradingMode}`, logContext);

    let promptExecutionTasks: PromptExecutionTaskDocument[] = [];
    switch (task.gradingMode) {
      case 'Unstructured Google Doc':
        promptExecutionTasks = await prepareDefaultPrompt(task, config, logContext);
        break;
      case 'Table Sections Google Doc':
        promptExecutionTasks = await prepareStructuredTablePrompt(task, config, logContext);
        break;
      case 'SM Response':
        promptExecutionTasks = await prepareSMResponsesPrompt(task, config, logContext);
        break;
    }

    if (promptExecutionTasks.length === 0) {
      throw new NonRetryableError(`No grading tasks have been generated`);
    }

    log.info(`Produced ${promptExecutionTasks.length} prompt execution tasks, persisting and queuing`);

    // Setup progress tracking
    task.totalSubTasksCount = promptExecutionTasks.length;
    task.executedSubTasksCount = 0;
    task.status = 'GradingStarted';

    // Persist the documents
    await DynamoDB.putDocuments([task, ...promptExecutionTasks]);

    // Queue the tasks
    await Sqs.bulkSendMessages(
      promptExecutionTasks.map((it) => ({
        type: 'execute-prompt',
        taskId: task.id,
        promptExecutionKey: {
          pk: it.pk,
          sk: it.sk,
        },
      })),
    );
  } catch (e: any) {
    log.error(`Error during prompt execution task`, e, logContext);

    if (e instanceof NonRetryableError || (message.retries ?? 0) >= Config.getNumRetires()) {
      // Fail task if we will not retry
      await failGradingWithMessage(task, e?.message ?? `${e}`, logContext);
    }

    // Propagate to parent call
    throw e;
  }
}

async function failGradingWithMessage(
  task: GradingTaskDocument,
  message: string,
  logContext?: GradingBotLoggingContext,
): Promise<void> {
  task.gradingError = message;
  task.status = 'GradingError';

  log.warn(`Failing grading task due to error: ${message}`, logContext);

  if (task.gradingBatchId != null) {
    log.info(`Detected parent grading batch, incrementing counter for ${task.gradingBatchId}`);
    await GradingBatch.incrementTaskCounter(task.gradingBatchId);
  }
  await DynamoDB.putDocument(task);

  await delayCallbackEvent(task, {
    event: 'grading-complete',
    error: message,
  });
}
