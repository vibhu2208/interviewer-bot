import { NonRetryableError } from '../../src/common/non-retryable-error';
import { DynamoDB } from '../../src/integrations/dynamodb';
import { Sqs } from '../../src/integrations/sqs';
import { GradingTask } from '../../src/model/grading-task';
import { PromptExecutionTask } from '../../src/model/prompt-execution-task';
import { gradeSubmissionPrepareTasks } from '../../src/tasks/grade-submission-prepare-tasks';

jest.mock('../../src/processors/sm-response', () => ({
  prepareSMResponsesPrompt: jest
    .fn()
    .mockResolvedValue([PromptExecutionTask.newDocumentWithPromptFor('system1', 'user1', {} as any)]),
}));
jest.mock('../../src/processors/unstructured-google-doc', () => ({
  prepareDefaultPrompt: jest
    .fn()
    .mockResolvedValue([PromptExecutionTask.newDocumentWithPromptFor('system2', 'user2', {} as any)]),
}));
jest.mock('../../src/processors/table-sections-google-doc', () => ({
  prepareStructuredTablePrompt: jest
    .fn()
    .mockResolvedValue([PromptExecutionTask.newDocumentWithPromptFor('system3', 'user3', {} as any)]),
}));
jest.mock('../../src/tasks/send-status-event', () => ({
  delayCallbackEvent: jest.fn(),
}));

describe('gradeSubmissionPrepareTasks', () => {
  it('should create sub-tasks based on the input', async () => {
    // Arrange
    const task = GradingTask.newDocument({
      gradingMode: 'SM Response',
      status: 'Pending',
      rules: [],
      applicationStepResultId: '2',
      applicationStepId: '3',
    });
    GradingTask.getByIdOrThrow = jest.fn().mockResolvedValue(task);
    DynamoDB.putDocuments = jest.fn();
    Sqs.bulkSendMessages = jest.fn();

    // Act
    await gradeSubmissionPrepareTasks(
      {
        type: 'grade-submission',
        taskId: '1',
      },
      {} as any,
    );

    // Assert
    expect(Sqs.bulkSendMessages).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: task.id,
        type: 'execute-prompt',
      }),
    ]);

    expect(DynamoDB.putDocuments).toHaveBeenCalledWith([
      expect.objectContaining({
        id: task.id,
        status: 'GradingStarted',
        totalSubTasksCount: 1,
        executedSubTasksCount: 0,
      }),
      expect.any(Object),
    ]);
  });

  it('should handle failure and store error on non-retryable', async () => {
    // Arrange
    const task = GradingTask.newDocument({
      gradingMode: 'SM Response',
      status: 'Pending',
      rules: [],
      applicationStepResultId: '2',
      applicationStepId: '3',
    });
    GradingTask.getByIdOrThrow = jest.fn().mockResolvedValue(task);
    const error = new NonRetryableError('Bad');
    DynamoDB.putDocuments = jest.fn().mockRejectedValue(error);
    DynamoDB.putDocument = jest.fn();

    // Act & Assert
    await expect(
      gradeSubmissionPrepareTasks(
        {
          type: 'grade-submission',
          taskId: '1',
        },
        {} as any,
      ),
    ).rejects.toThrowError(error);

    expect(DynamoDB.putDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        status: 'GradingError',
        gradingError: 'Bad',
      }),
    );
  });
});
