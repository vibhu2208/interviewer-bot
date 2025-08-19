import { DynamoDB } from '../../src/integrations/dynamodb';
import { GradingTask, GradingTaskDocument } from '../../src/model/grading-task';
import { PromptExecutionTask, PromptExecutionTaskDocument } from '../../src/model/prompt-execution-task';
import { gradeSubmissionCalculateResult } from '../../src/tasks/grade-submissions-calculate-result';
import { sendErrorEvent } from '../../src/tasks/send-status-event';

jest.mock('../../src/tasks/send-status-event', () => ({
  delayCallbackEvent: jest.fn(),
  sendErrorEvent: jest.fn(),
}));

describe('gradeSubmissionCalculateResult', () => {
  it('should gather results from sub-tasks and generate event', async () => {
    // Arrange
    const task: GradingTaskDocument = GradingTask.newDocument({
      applicationStepId: '1',
      applicationStepResultId: '2',
      callbackUrl: 'https://none.com',
      status: 'GradingStarted',
      rules: [
        {
          id: '1',
          name: 'Rule 1',
          applicationStepId: '1',
          rule: 'Check this',
        },
        {
          id: '2',
          name: 'Rule 2',
          applicationStepId: '1',
          rule: 'Check that',
        },
      ],
    });
    PromptExecutionTask.getAllForParent = jest.fn().mockResolvedValue([
      {
        relatedId: '1',
        messages: [
          {
            role: 'system',
            content: 'system prompt',
          },
          {
            role: 'user',
            content: 'user prompt',
          },
        ],
        grading: {
          result: 'Pass',
          confidence: 1,
          reasoning: 'Why not',
          feedback: 'Itsokay',
        },
      },
      {
        relatedId: '2',
        messages: [
          {
            role: 'system',
            content: 'system prompt',
          },
          {
            role: 'user',
            content: 'user prompt',
          },
        ],
        errors: ['Error: Something happened', 'Error: And again'],
      },
    ] as Partial<PromptExecutionTaskDocument>[]);
    DynamoDB.putDocument = jest.fn();

    // Act
    await gradeSubmissionCalculateResult(task);

    // Assert
    expect(DynamoDB.putDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationStepId: '1',
        applicationStepResultId: '2',
        callbackUrl: 'https://none.com',
        rules: [
          {
            applicationStepId: '1',
            id: '1',
            name: 'Rule 1',
            rule: 'Check this',
          },
          {
            applicationStepId: '1',
            id: '2',
            name: 'Rule 2',
            rule: 'Check that',
          },
        ],
        status: 'Graded',
      }),
    );
  });

  it('should send an error event and rethrow when an error occurs', async () => {
    // Arrange
    const task: GradingTaskDocument = {
      id: '123',
      applicationStepId: '1',
      applicationStepResultId: '2',
      callbackUrl: 'https://none.com',
      status: 'GradingStarted',
      rules: [],
    } as any;
    const error = new Error('Test error');
    DynamoDB.putDocument = jest.fn().mockRejectedValue(error);
    PromptExecutionTask.getAllForParent = jest.fn().mockResolvedValue([]);

    // Act
    await expect(gradeSubmissionCalculateResult(task)).rejects.toThrow(error);

    // Assert
    expect(sendErrorEvent).toHaveBeenCalledWith(task, `Error while grading submission: ${error.message}`);
  });
});
