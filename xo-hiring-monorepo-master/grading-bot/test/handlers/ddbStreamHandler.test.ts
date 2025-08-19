import { handler } from '../../src/handlers/ddbStreamHandler';
import { DynamoDB } from '../../src/integrations/dynamodb';
import { getGradingBatchKey, GradingBatch, GradingBatchDocument } from '../../src/model/grading-batch';
import { getGradingTaskKey, GradingTaskDocument } from '../../src/model/grading-task';
import { handleCompletedBatchResults } from '../../src/tasks/generate-dry-run-results';
import { gradeSubmissionCalculateResult } from '../../src/tasks/grade-submissions-calculate-result';

jest.mock('../../src/tasks/grade-submissions-calculate-result', () => ({
  gradeSubmissionCalculateResult: jest.fn(),
}));
jest.mock('../../src/tasks/generate-dry-run-results', () => ({
  handleCompletedBatchResults: jest.fn(),
}));

describe('ddbStreamHandler', () => {
  test('Should trigger gradeSubmissionCalculateResult when all sub-tasks completed', async () => {
    // Arrange
    const baseDocument: Partial<GradingTaskDocument> = {
      ...getGradingTaskKey('1'),
      id: '1',
      totalSubTasksCount: 1,
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...baseDocument,
        executedSubTasksCount: 1,
      })
      .mockReturnValueOnce({
        // Old Image
        ...baseDocument,
        executedSubTasksCount: 0,
      });

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
          dynamodb: {
            OldImage: true as any,
            NewImage: true as any,
          },
        },
      ],
    });

    // Assert
    expect(gradeSubmissionCalculateResult).toBeCalledWith(
      expect.objectContaining({
        id: '1',
        executedSubTasksCount: 1,
        totalSubTasksCount: 1,
      }),
    );
  });

  test('Should trigger handleCompletedBatchResults when all tasks completed', async () => {
    // Arrange
    const baseDocument: Partial<GradingBatchDocument> = {
      ...getGradingBatchKey('1'),
      id: '1',
      tasksCount: 2,
      tasksCompleted: 1,
    };

    DynamoDB.unmarshall = jest
      .fn()
      .mockReturnValueOnce({
        // New Image
        ...baseDocument,
        tasksCompleted: 2,
      })
      .mockReturnValueOnce({
        // Old Image
        ...baseDocument,
      });

    // Act
    await handler({
      Records: [
        {
          eventName: 'MODIFY',
          // Records are mocked with jest
          dynamodb: {
            OldImage: true as any,
            NewImage: true as any,
          },
        },
      ],
    });

    // Assert
    expect(handleCompletedBatchResults).toBeCalledWith(
      expect.objectContaining({
        id: '1',
      }),
    );
  });
});
