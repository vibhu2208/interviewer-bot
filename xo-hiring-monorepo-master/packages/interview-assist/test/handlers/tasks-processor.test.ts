import { SQSEvent } from 'aws-lambda';
import { processTasks } from '../../src/handlers/tasks-processor';
import { generateSummary } from '../../src/tasks/generate-summary';

// Mock dependencies
jest.mock('../../src/tasks/generate-summary', () => ({
  generateSummary: jest.fn(),
}));

describe('processTasks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process valid messages and call the appropriate handlers', async () => {
    const event: SQSEvent = {
      Records: [
        {
          body: JSON.stringify({
            type: 'generate-summary',
            transcriptId: '123',
            promptId: '456',
          }),
        },
      ],
    } as unknown as SQSEvent;

    await expect(processTasks(event)).resolves.toEqual({ batchItemFailures: [] });

    expect(generateSummary).toHaveBeenCalledWith('123', '456');
    expect(generateSummary).toHaveBeenCalledTimes(1);
  });

  it('should return failed message IDs for errors during processing', async () => {
    const event: SQSEvent = {
      Records: [
        {
          messageId: 'msg1',
          body: JSON.stringify({
            type: 'generate-summary',
            transcriptId: '1',
            promptId: '2',
          }),
        },
      ],
    } as unknown as SQSEvent;

    (generateSummary as jest.Mock).mockRejectedValueOnce(new Error('Processing error'));

    const result = await processTasks(event);

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: 'msg1' }],
    });

    expect(generateSummary).toHaveBeenCalledTimes(1);
    expect(generateSummary).toHaveBeenCalledWith('1', '2');
  });

  it('should skip unknown message types without stopping processing', async () => {
    const event: SQSEvent = {
      Records: [
        {
          body: JSON.stringify({
            type: 'unknown-type',
          }),
        },
      ],
    } as unknown as SQSEvent;

    await expect(processTasks(event)).resolves.toEqual({ batchItemFailures: [] });

    expect(generateSummary).not.toHaveBeenCalled();
  });

  it('should return failed message ID for invalid JSON', async () => {
    const event: SQSEvent = {
      Records: [
        {
          messageId: 'msg1',
          body: 'INVALID JSON',
        },
      ],
    } as unknown as SQSEvent;

    const result = await processTasks(event);

    expect(result).toEqual({
      batchItemFailures: [{ itemIdentifier: 'msg1' }],
    });
    expect(generateSummary).not.toHaveBeenCalled();
  });
});
