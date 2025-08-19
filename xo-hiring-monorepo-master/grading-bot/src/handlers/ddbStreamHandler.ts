import { DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';
import { GradingBatchDocument, isGradingBatch } from '../model/grading-batch';
import { GradingTaskDocument, isGradingTask } from '../model/grading-task';
import { handleCompletedBatchResults } from '../tasks/generate-dry-run-results';
import { gradeSubmissionCalculateResult } from '../tasks/grade-submissions-calculate-result';

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  for (const record of event.Records) {
    if (record.eventName === 'MODIFY' && record.dynamodb?.NewImage != null && record.dynamodb?.OldImage != null) {
      const newDocument = DynamoDB.unmarshall<MainTableKeys>(record.dynamodb.NewImage);
      const oldDocument = DynamoDB.unmarshall<MainTableKeys>(record.dynamodb.OldImage);
      if (newDocument != null && oldDocument != null) {
        if (isGradingTask(newDocument)) {
          // We want to track progress on grading tasks
          const oldTask: GradingTaskDocument = oldDocument as GradingTaskDocument;
          const newTask: GradingTaskDocument = newDocument as GradingTaskDocument;
          // Track sub-tasks completion
          if (
            newTask.executedSubTasksCount !== oldTask.executedSubTasksCount &&
            newTask.executedSubTasksCount === newTask.totalSubTasksCount &&
            newTask.totalSubTasksCount !== 0
          ) {
            // If all sub-tasks are done we should do a final calculation
            await gradeSubmissionCalculateResult(newTask);
          }
        } else if (isGradingBatch(newDocument)) {
          // We want to track progress on grading batch
          const oldBatch: GradingBatchDocument = oldDocument as GradingBatchDocument;
          const newBatch: GradingBatchDocument = newDocument as GradingBatchDocument;
          // Track tasks completion
          if (
            newBatch.tasksCompleted !== oldBatch.tasksCompleted &&
            newBatch.tasksCompleted === newBatch.tasksCount &&
            newBatch.tasksCount !== 0
          ) {
            // Batch completed, return the results
            await handleCompletedBatchResults(newBatch);
          }
        }
      }
    }
  }
}
