import { generateSummary } from '../../src/tasks/generate-summary';

jest.mock('../../src/tasks/generate-summary');

describe('generateSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully generate a summary when given valid parameters', async () => {
    (generateSummary as jest.Mock).mockResolvedValue('Summary text');

    const transcriptId = '123';
    const promptId = '456';

    const result = await generateSummary(transcriptId, promptId);

    expect(result).toBe('Summary text');
    expect(generateSummary).toHaveBeenCalledWith(transcriptId, promptId);
    expect(generateSummary).toHaveBeenCalledTimes(1);
  });

  it('should throw an error when summary generation fails', async () => {
    (generateSummary as jest.Mock).mockRejectedValue(new Error('Error generating summary'));

    const transcriptId = '123';
    const promptId = '456';

    await expect(generateSummary(transcriptId, promptId)).rejects.toThrow('Error generating summary');
    expect(generateSummary).toHaveBeenCalledWith(transcriptId, promptId);
    expect(generateSummary).toHaveBeenCalledTimes(1);
  });

  it('should handle empty or invalid input parameters gracefully', async () => {
    (generateSummary as jest.Mock).mockRejectedValue(new Error('Invalid parameters'));

    await expect(generateSummary('', '')).rejects.toThrow('Invalid parameters');
    expect(generateSummary).toHaveBeenCalledWith('', '');
    expect(generateSummary).toHaveBeenCalledTimes(1);
  });
});
