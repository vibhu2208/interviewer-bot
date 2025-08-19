import { Logger } from '../common/logger';
import { DynamoDB } from '../integrations/dynamodb';
import { GradingBatch } from '../model/grading-batch';
import { GradingTaskDocument } from '../model/grading-task';
import { delayCallbackEvent, sendErrorEvent } from './send-status-event';

const log = Logger.create('grade-submissions-cr');

export async function gradeSubmissionCalculateResult(task: GradingTaskDocument): Promise<void> {
  try {
    await gradeSubmissionCalculateResultLogic(task);
  } catch (e) {
    // Log error, send a message to SF and attempt to retry (re-throw)
    log.error(`Error while grading submission`, task, e);
    await sendErrorEvent(task, `Error while grading submission: ${(e as Error).message}`);
    throw e;
  }
}

async function gradeSubmissionCalculateResultLogic(task: GradingTaskDocument): Promise<void> {
  const logContext = log.context({ taskId: task.id, batchId: task.gradingBatchId }, task);

  task.status = 'Graded';

  // Update task
  await DynamoDB.putDocument(task);
  log.info(`Task is graded`, logContext, {
    grading: task.grading,
  });

  if (task.gradingBatchId != null) {
    log.info(`Detected parent grading batch, incrementing counter for ${task.gradingBatchId}`);
    await GradingBatch.incrementTaskCounter(task.gradingBatchId);
  }

  // Send status event
  await delayCallbackEvent(task, {
    event: 'grading-complete',
  });
}
