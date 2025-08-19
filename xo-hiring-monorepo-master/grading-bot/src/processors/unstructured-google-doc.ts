import * as docs from '@googleapis/docs';
import Handlebars from 'handlebars';
import { ContentExtraction } from '../common/content-extraction';
import { GradingBotLoggingContext, Logger } from '../common/logger';
import { GoogleDocs } from '../integrations/google-docs';
import { GradingBotSsmConfig } from '../integrations/ssm';
import { GradingTaskDocument } from '../model/grading-task';
import { PromptExecutionTask, PromptExecutionTaskDocument } from '../model/prompt-execution-task';

const log = Logger.create('unstructured-google-doc');

export async function prepareDefaultPrompt(
  task: GradingTaskDocument,
  config: GradingBotSsmConfig,
  logContext?: GradingBotLoggingContext,
): Promise<PromptExecutionTaskDocument[]> {
  // Get content of the Google Document
  const document: docs.docs_v1.Schema$Body = await GoogleDocs.fetchGoogleDocumentContent(task.submissionLink);

  // Transform it into a plain text format
  const content = ContentExtraction.extractText(document);

  log.info(`Preparing default prompts for task`, logContext);
  // Uses unstructured prompt
  const systemPromptTemplate = Handlebars.compile(config.prompts.unstructuredSystem, { noEscape: true });
  const userPromptTemplate = Handlebars.compile(config.prompts.unstructuredUser, { noEscape: true });

  // For every grading rule generate a separate grading task
  const result: PromptExecutionTaskDocument[] = [];
  for (const rule of task.rules) {
    // For the default unstructured prompt we just provide the whole document as a content
    const context = {
      rule,
      content,
    };

    const systemPrompt = systemPromptTemplate(context);
    const userPrompt = userPromptTemplate(context);

    log.plain(`DEFAULT_GRADING_SYSTEM_PROMPT; ${rule.name}; ${task.id}`, systemPrompt);
    log.plain(`DEFAULT_GRADING_USER_PROMPT; ${rule.name}; ${task.id}`, userPrompt);

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
