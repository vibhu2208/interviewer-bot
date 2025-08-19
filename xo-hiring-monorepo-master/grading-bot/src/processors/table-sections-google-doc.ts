import * as docs from '@googleapis/docs';
import Handlebars from 'handlebars';
import { ContentExtraction } from '../common/content-extraction';
import { GradingBotLoggingContext, Logger } from '../common/logger';
import { NonRetryableError } from '../common/non-retryable-error';
import { like } from '../common/util';
import { GoogleDocs } from '../integrations/google-docs';
import { GradingBotSsmConfig } from '../integrations/ssm';
import { GradingTaskDocument, QuestionAndAnswer } from '../model/grading-task';
import { PromptExecutionTask, PromptExecutionTaskDocument } from '../model/prompt-execution-task';

const log = Logger.create('table-sections-google-doc');

export async function prepareStructuredTablePrompt(
  task: GradingTaskDocument,
  config: GradingBotSsmConfig,
  logContext?: GradingBotLoggingContext,
): Promise<PromptExecutionTaskDocument[]> {
  // Get content of the Google Document
  const document: docs.docs_v1.Schema$Body = await GoogleDocs.fetchGoogleDocumentContent(task.submissionLink);

  // Extract table content into array of sections
  const sections = ContentExtraction.extractSections(document);
  if (sections == null) {
    throw new NonRetryableError(`Cannot extract sections from the Google Document: '${task.submissionLink}'`);
  }

  log.info(`Preparing structured table prompts for task`, logContext);
  // Uses structured prompt
  const systemPromptTemplate = Handlebars.compile(config.prompts.structuredSystem, { noEscape: true });
  const userPromptTemplate = Handlebars.compile(config.prompts.structuredUser, { noEscape: true });

  // For every grading rule generate a separate grading task
  const result: PromptExecutionTaskDocument[] = [];
  for (const rule of task.rules) {
    // Find applicable sections for the rule
    const contents: QuestionAndAnswer[] = sections
      .filter((section) => {
        // This rule is not related to the specific question, just return all questions
        if (rule.smKeyNamePattern == null) {
          return true;
        }

        // Related to the specific question, perform matching
        return like(section.header, rule.smKeyNamePattern);
      })
      .map((section) => ({ question: section.header, answer: section.content }));

    // For the default unstructured prompt we just provide the whole document as a content
    const context = {
      rule,
      contents,
    };

    const systemPrompt = systemPromptTemplate(context);
    const userPrompt = userPromptTemplate(context);

    log.plain(`STRUCTURED_TABLE_GRADING_SYSTEM_PROMPT; ${rule.name}; ${task.id}`, systemPrompt);
    log.plain(`STRUCTURED_TABLE_GRADING_USER_PROMPT; ${rule.name}; ${task.id}`, userPrompt);

    result.push(
      PromptExecutionTask.newDocumentWithPromptFor(systemPrompt, userPrompt, task, {
        id: rule.id,
        relatedId: rule.id,
      }),
    );
  }

  // Do not insert the document here, it will be covered by the caller
  return result;
}
