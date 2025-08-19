import { SQSRecord } from 'aws-lambda';
import { NonRetryableError } from '../../../src/common/non-retryable-error';

jest.mock('../../../src/tasks/gptAttemptUserPrompt');
jest.mock('../../../src/tasks/gptGenerateCalibratedQuestions');
jest.mock('../../../src/tasks/gptGradeIndividualAnswer');
jest.mock('../../../src/tasks/gptPrepareQuestionsForSession');

import { handler } from '../../../src/handlers/processGptCommandQueue';
import { Sqs } from '../../../src/integrations/sqs';
import { Sns } from '../../../src/integrations/sns';

import * as task1 from '../../../src/tasks/gptPrepareQuestionsForSession';
import * as task2 from '../../../src/tasks/gptGradeIndividualAnswer';

describe('processGptCommandQueue', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('Should trigger task on valid input', async () => {
    // Arrange
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          body: JSON.stringify({
            type: 'prepare-session',
          }),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result.batchItemFailures).toHaveLength(0);
    expect(task1.gptPrepareQuestionsForSession).toBeCalledTimes(1);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
  });

  test('Should retry on task error', async () => {
    // Arrange
    jest.spyOn(task1, 'gptPrepareQuestionsForSession').mockRejectedValue(new Error('Test'));
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          body: JSON.stringify({
            type: 'prepare-session',
          }),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result.batchItemFailures).toHaveLength(0);
    expect(task1.gptPrepareQuestionsForSession).toBeCalledTimes(1);
    expect(Sqs.sendGptMessage).toBeCalledTimes(1);
    expect(Sqs.sendGptMessage).toBeCalledWith(
      expect.objectContaining({
        type: 'prepare-session',
        retries: 1,
      }),
      3 * 60,
    );
  });

  test('Should retry sooner on ChatGpt error', async () => {
    // Arrange
    jest.spyOn(task1, 'gptPrepareQuestionsForSession').mockRejectedValue(new Error('GPT responded with null output'));
    Sqs.sendGptMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          body: JSON.stringify({
            type: 'prepare-session',
          }),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result.batchItemFailures).toHaveLength(0);
    expect(task1.gptPrepareQuestionsForSession).toBeCalledTimes(1);
    expect(Sqs.sendGptMessage).toBeCalledTimes(1);
    expect(Sqs.sendGptMessage).toBeCalledWith(
      expect.objectContaining({
        type: 'prepare-session',
        retries: 1,
      }),
      3 * 60,
    );
  });

  test('Should reject on task error and retry limit', async () => {
    // Arrange
    jest.spyOn(task1, 'gptPrepareQuestionsForSession').mockRejectedValue(new Error('Test'));
    Sqs.sendGptMessage = jest.fn();
    Sns.publishMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          messageId: '1',
          body: JSON.stringify({
            type: 'prepare-session',
            retries: 100,
          }),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result.batchItemFailures).toHaveLength(1);
    expect(task1.gptPrepareQuestionsForSession).toBeCalledTimes(1);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
    expect(Sns.publishMessage).toBeCalledTimes(0);
  });

  test('Should reject and notify on grading task error and retry limit', async () => {
    // Arrange
    jest.spyOn(task2, 'gptGradeIndividualAnswer').mockRejectedValue(new Error('Test'));
    Sqs.sendGptMessage = jest.fn();
    Sns.publishMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          messageId: '1',
          body: JSON.stringify({
            type: 'grade-individual-answer',
            retries: 100,
          }),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result.batchItemFailures).toHaveLength(1);
    expect(task2.gptGradeIndividualAnswer).toBeCalledTimes(1);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
    expect(Sns.publishMessage).toBeCalledTimes(1);
  });

  test('Should not process further on NonRetryableError', async () => {
    // Arrange
    jest.spyOn(task1, 'gptPrepareQuestionsForSession').mockRejectedValue(new NonRetryableError('Test'));
    Sqs.sendGptMessage = jest.fn();
    Sns.publishMessage = jest.fn();

    // Act
    const result = await handler({
      Records: [
        {
          messageId: '1',
          body: JSON.stringify({
            type: 'prepare-session',
          }),
        } as SQSRecord,
      ],
    });

    // Assert
    expect(result.batchItemFailures).toHaveLength(0);
    expect(task1.gptPrepareQuestionsForSession).toBeCalledTimes(1);
    expect(Sqs.sendGptMessage).toBeCalledTimes(0);
    expect(Sns.publishMessage).toBeCalledTimes(0);
  });
});
