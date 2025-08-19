import { GradingBotLoggingContext, Logger } from '../common/logger';
import { NonRetryableError } from '../common/non-retryable-error';
import { GoogleColab } from '../integrations/google-colab';
import { GoogleDocs } from '../integrations/google-docs';
import { GoogleSheets } from '../integrations/google-sheets';
import { GradingRule } from '../model/grading-rule';
import { QuestionAndAnswer } from '../model/grading-task';

const log = Logger.create('extract-content');

// Global cache to store extracted content and errors
const ContentCache: Map<string, { content: string | null; error: string | null }> = new Map();

/**
 * Based on the content type of the grading rule, extract the content from the question and answer
 * Also has a runtime cache to avoid re-extracting the same content
 * @param qna
 * @param rule
 * @param logContext
 * @throws NonRetryableError if the content type is 'URL' and the content cannot be extracted
 */
export async function extractContent(
  qna: QuestionAndAnswer[],
  rule: GradingRule,
  logContext?: GradingBotLoggingContext,
): Promise<QuestionAndAnswer[]> {
  // Auto is a default mode
  if (rule.contentType == null) {
    rule.contentType = 'Auto';
  }

  // For 'Text' we just treat the answer as a content
  if (rule.contentType === 'Text') {
    return qna;
  }

  // Now we will try to treat the answer as a URL and see if we can extract it
  const extractedQna: QuestionAndAnswer[] = [];

  for (const item of qna) {
    let extractedAnswer: string | null = null;
    let extractionError: string | null = null;

    if (!item.answer.startsWith('http')) {
      // There is no point to attempt any extraction if the answer is not at least an HTTP URL
      // We also do not want to cache such answers
    } else if (ContentCache.has(item.answer)) {
      // Check the runtime cache
      const cachedResult = ContentCache.get(item.answer);
      extractedAnswer = cachedResult?.content ?? null;
      extractionError = cachedResult?.error ?? null;
    } else {
      // Perform the actual extraction if we do not have anything in cache
      if (GoogleDocs.canBeGoogleDocument(item.answer)) {
        try {
          extractedAnswer = await GoogleDocs.exportAsText(item.answer);
          log.info(`Extracted Google Doc content from ${item.answer}`, logContext);
        } catch (error) {
          extractionError = `Failed to extract Google Doc content: ${error}`;
        }
      } else if (GoogleSheets.canBeGoogleSheet(item.answer)) {
        try {
          extractedAnswer = await GoogleSheets.exportAsMarkdown(item.answer);
          log.info(`Extracted Google Sheets content from ${item.answer}`, logContext);
        } catch (error) {
          extractionError = `Failed to extract Google Sheets content: ${error}`;
        }
      } else if (GoogleColab.canBeColabNotebook(item.answer)) {
        try {
          extractedAnswer = await GoogleColab.exportAsMarkdownOrJson(item.answer);
          log.info(`Extracted Google Colab content from ${item.answer}`, logContext);
        } catch (error) {
          extractionError = `Failed to extract Google Colab content: ${error}`;
        }
      }

      // Cache the result, whether it's successful content or an error
      ContentCache.set(item.answer, { content: extractedAnswer, error: extractionError });
    }

    if (extractionError != null) {
      log.warn(`Error extracting content: ${extractionError}`, logContext);
    }

    if (rule.contentType === 'Auto') {
      // For the auto mode extraction error is not critical, we will fall back to the original content
      if (extractedAnswer == null) {
        extractedAnswer = item.answer;
      }
      extractedQna.push({
        question: item.question,
        answer: extractedAnswer,
      });
    } else if (rule.contentType === 'URL') {
      // For the URL mode extraction error is critical, we will throw an error if we failed to extract the content
      if (extractionError != null) {
        throw new NonRetryableError(`Cannot extract content from the URL (${item.answer}): ${extractionError}`);
      }
      if (extractedAnswer == null) {
        throw new NonRetryableError(`Cannot identify answer as a valid data source URL: ${item.answer}`);
      }
      extractedQna.push({
        question: item.question,
        answer: extractedAnswer,
      });
    }
  }

  return extractedQna;
}
