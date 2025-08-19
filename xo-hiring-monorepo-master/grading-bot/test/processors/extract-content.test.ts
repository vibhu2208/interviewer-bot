import { extractContent } from '../../src/processors/extract-content';
import { GradingRule } from '../../src/model/grading-rule';
import { QuestionAndAnswer } from '../../src/model/grading-task';
import { GoogleDocs } from '../../src/integrations/google-docs';
import { GoogleSheets } from '../../src/integrations/google-sheets';
import { GoogleColab } from '../../src/integrations/google-colab';
import { NonRetryableError } from '../../src/common/non-retryable-error';

jest.mock('../../src/integrations/google-docs');
jest.mock('../../src/integrations/google-sheets');
jest.mock('../../src/integrations/google-colab');

describe('extractContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
  });

  it('should handle Auto content type correctly', async () => {
    const qna: QuestionAndAnswer[] = [
      { question: 'Q1', answer: 'Plain text answer' },
      { question: 'Q2', answer: 'https://docs.google.com/document/d/validId' },
      { question: 'Q3', answer: 'https://docs.google.com/document/d/invalidId' },
    ];
    const rule: GradingRule = { id: '1', name: 'Test', rule: 'Test', applicationStepId: '1', contentType: 'Auto' };

    (GoogleDocs.canBeGoogleDocument as jest.Mock).mockReturnValue(true);
    (GoogleDocs.exportAsText as jest.Mock).mockResolvedValueOnce('Valid Google Doc content');
    (GoogleDocs.exportAsText as jest.Mock).mockRejectedValueOnce(new Error('Invalid document'));

    const result = await extractContent(qna, rule);

    expect(result).toHaveLength(3);
    expect(result[0].answer).toBe('Plain text answer');
    expect(result[1].answer).toBe('Valid Google Doc content');
    expect(result[2].answer).toBe('https://docs.google.com/document/d/invalidId');
  });

  it('should handle Text content type correctly', async () => {
    const qna: QuestionAndAnswer[] = [
      { question: 'Q1', answer: 'https://docs.google.com/document/d/validId' },
      { question: 'Q2', answer: 'Just random text' },
    ];
    const rule: GradingRule = { id: '1', name: 'Test', rule: 'Test', applicationStepId: '1', contentType: 'Text' };

    const result = await extractContent(qna, rule);

    expect(result).toHaveLength(2);
    expect(result[0].answer).toBe('https://docs.google.com/document/d/validId');
    expect(result[1].answer).toBe('Just random text');
    expect(GoogleDocs.exportAsText).not.toHaveBeenCalled();
  });

  it('should handle URL content type with valid URLs', async () => {
    const qna: QuestionAndAnswer[] = [
      { question: 'Q1', answer: 'https://docs.google.com/document/d/validId1' },
      { question: 'Q2', answer: 'https://docs.google.com/spreadsheets/d/validId2' },
      { question: 'Q3', answer: 'https://colab.research.google.com/drive/validId3' },
    ];
    const rule: GradingRule = { id: '1', name: 'Test', rule: 'Test', applicationStepId: '1', contentType: 'URL' };

    (GoogleDocs.canBeGoogleDocument as jest.Mock).mockReturnValueOnce(true);
    (GoogleDocs.exportAsText as jest.Mock).mockResolvedValueOnce('Google Doc content');
    (GoogleSheets.canBeGoogleSheet as jest.Mock).mockReturnValueOnce(true);
    (GoogleSheets.exportAsMarkdown as jest.Mock).mockResolvedValueOnce('Google Sheet content');
    (GoogleColab.canBeColabNotebook as jest.Mock).mockReturnValueOnce(true);
    (GoogleColab.exportAsMarkdownOrJson as jest.Mock).mockResolvedValueOnce('Google Colab content');

    const result = await extractContent(qna, rule);

    expect(result).toHaveLength(3);
    expect(result[0].answer).toBe('Google Doc content');
    expect(result[1].answer).toBe('Google Sheet content');
    expect(result[2].answer).toBe('Google Colab content');
  });

  it('should throw NonRetryableError for URL content type with invalid URLs', async () => {
    const qna: QuestionAndAnswer[] = [{ question: 'Q1', answer: 'https://invalid-url.com' }];
    const rule: GradingRule = { id: '1', name: 'Test', rule: 'Test', applicationStepId: '1', contentType: 'URL' };

    (GoogleDocs.canBeGoogleDocument as jest.Mock).mockReturnValue(false);
    (GoogleSheets.canBeGoogleSheet as jest.Mock).mockReturnValue(false);
    (GoogleColab.canBeColabNotebook as jest.Mock).mockReturnValue(false);

    await expect(extractContent(qna, rule)).rejects.toThrow(NonRetryableError);
  });
});
