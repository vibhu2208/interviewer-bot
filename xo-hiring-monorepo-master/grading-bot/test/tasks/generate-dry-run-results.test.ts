import { Config } from '../../src/config';
import { handleCompletedBatchResults } from '../../src/tasks/generate-dry-run-results';
import { GradingBatch } from '../../src/model/grading-batch';
import { GradingTask } from '../../src/model/grading-task';
import { Email } from '../../src/integrations/email';

jest.mock('@aws-sdk/client-s3', () => {
  const originalModule = jest.requireActual('@aws-sdk/client-s3');

  // Mock the S3Client class
  return {
    ...originalModule,
    S3Client: jest.fn().mockImplementation(() => {
      return {
        send: jest.fn(),
      };
    }),
  };
});

describe('handleCompletedBatchResults', () => {
  it('should process batch results and send email with results', async () => {
    // Arrange
    const batch = GradingBatch.newDocument({
      tasksCount: 1,
      tasksCompleted: 1,
      data: {
        applicationStepId: '1',
        startDate: '2021-01-01T00:00:00Z',
        endDate: '2021-01-02T00:00:00Z',
        recipientEmail: 'test@example.com',
        notes: 'Test batch notes',
      },
    });

    const task = GradingTask.newDocument({
      status: 'Graded',
      rules: [
        {
          id: 'rule-1',
          name: 'Rule 1',
          rule: 'Check this',
          applicationStepId: '1',
        },
      ],
      applicationStepResultId: 'asr-1',
      applicationStepId: 'app-step-1',
      data: {
        score: '100',
        grader: 'Auto',
        applicationName: 'Test Application',
        submissionTime: '2021-01-01T12:00:00Z',
      },
      grading: [
        {
          result: 'Pass',
          confidence: 0.9,
          reasoning: 'Correct answer',
          feedback: 'Good job',
          systemPrompt: 'System prompt',
          userPrompt: 'User prompt',
        },
      ],
    });

    GradingTask.getForBatch = jest.fn().mockResolvedValue([task]);
    GradingTask.fillFromPromptExecutionTasks = jest.fn().mockResolvedValue(task);
    Email.getTransporter = jest.fn().mockReturnValue({
      sendMail: jest.fn().mockResolvedValue(true),
    });
    Config.getBatchReportsBucketName = jest.fn().mockReturnValue('none');

    // Act
    await handleCompletedBatchResults(batch);

    // Assert
    expect(GradingTask.getForBatch).toHaveBeenCalledWith(batch.id);
    expect(Email.getTransporter().sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@crossover.com',
        to: batch.data.recipientEmail,
        subject: `[Grading Bot] Batch is graded: ${batch.id}`,
        text: batch.data.notes,
      }),
    );
  });
});
