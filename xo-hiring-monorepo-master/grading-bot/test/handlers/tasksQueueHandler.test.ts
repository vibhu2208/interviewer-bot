import { NonRetryableError } from '../../src/common/non-retryable-error';
import { Config } from '../../src/config';
import { handler } from '../../src/handlers/tasksQueueHandler';
import { Sqs } from '../../src/integrations/sqs';
import { Ssm } from '../../src/integrations/ssm';
import { gradeSubmissionPrepareTasks } from '../../src/tasks/grade-submission-prepare-tasks';
import { processPromptExecutionMessage } from '../../src/tasks/process-prompt-execution-message';
import { sendCallbackEvent } from '../../src/tasks/send-status-event';

jest.mock('../../src/tasks/grade-submission-prepare-tasks', () => ({
  gradeSubmissionPrepareTasks: jest.fn(),
}));
jest.mock('../../src/tasks/process-prompt-execution-message', () => ({
  processPromptExecutionMessage: jest.fn(),
}));
jest.mock('../../src/tasks/send-status-event', () => ({
  sendCallbackEvent: jest.fn(),
}));

describe('tasksQueueHandler', () => {
  test('Should trigger related functions', async () => {
    // Arrange
    Ssm.getForEnvironment = jest.fn().mockResolvedValue({});

    // Act
    const response = await handler({
      Records: [
        {
          messageId: '1a',
          body: JSON.stringify({
            type: 'grade-submission',
            taskId: '1',
          }),
        },
        {
          messageId: '2a',
          body: JSON.stringify({
            type: 'send-grading-event',
            taskId: '2',
          }),
        },
        {
          messageId: '3a',
          body: JSON.stringify({
            type: 'execute-prompt',
            taskId: '3',
          }),
        },
      ],
    } as any);

    // Assert
    expect(response.batchItemFailures).toStrictEqual([]);
    expect(gradeSubmissionPrepareTasks).toBeCalledWith(
      {
        type: 'grade-submission',
        taskId: '1',
      },
      expect.any(Object),
    );
    expect(sendCallbackEvent).toBeCalledWith({
      type: 'send-grading-event',
      taskId: '2',
    });
    expect(processPromptExecutionMessage).toBeCalledWith({
      type: 'execute-prompt',
      taskId: '3',
    });
  });

  test('Should retry on retryable error', async () => {
    // Arrange
    Ssm.getForEnvironment = jest.fn().mockResolvedValue({});
    Sqs.sendMessage = jest.fn();
    (gradeSubmissionPrepareTasks as jest.Mock).mockRejectedValue(new Error('Bad'));

    // Act
    const response = await handler({
      Records: [
        {
          messageId: '1a',
          body: JSON.stringify({
            type: 'grade-submission',
            taskId: '1',
          }),
        },
      ],
    } as any);

    // Assert
    expect(response.batchItemFailures).toStrictEqual([]);
    expect(Sqs.sendMessage).toBeCalledWith(
      expect.objectContaining({
        type: 'grade-submission',
        taskId: '1',
        retries: 1,
        errors: expect.any(Array),
      }),
      expect.any(Number),
    );
  });

  test('Should not retry/reject on non-retryable error', async () => {
    // Arrange
    Ssm.getForEnvironment = jest.fn().mockResolvedValue({});
    Sqs.sendMessage = jest.fn();
    (gradeSubmissionPrepareTasks as jest.Mock).mockRejectedValue(new NonRetryableError('Bad'));

    // Act
    const response = await handler({
      Records: [
        {
          messageId: '1a',
          body: JSON.stringify({
            type: 'grade-submission',
            taskId: '1',
          }),
        },
      ],
    } as any);

    // Assert
    expect(response.batchItemFailures).toStrictEqual([]);
    expect(Sqs.sendMessage).toBeCalledTimes(0);
  });

  test('Should reject message on retry limit', async () => {
    // Arrange
    Ssm.getForEnvironment = jest.fn().mockResolvedValue({});
    Sqs.sendMessage = jest.fn();
    (gradeSubmissionPrepareTasks as jest.Mock).mockRejectedValue(new Error('Bad'));

    // Act
    const response = await handler({
      Records: [
        {
          messageId: '1a',
          body: JSON.stringify({
            type: 'grade-submission',
            taskId: '1',
            retries: Config.getNumRetires(),
          }),
        },
      ],
    } as any);

    // Assert
    expect(response.batchItemFailures).toStrictEqual([
      {
        itemIdentifier: '1a',
      },
    ]);
    expect(Sqs.sendMessage).toBeCalledTimes(0);
  });
});
