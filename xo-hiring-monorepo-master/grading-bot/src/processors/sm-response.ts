import Handlebars from 'handlebars';
import { GradingBotLoggingContext, Logger } from '../common/logger';
import { NonRetryableError } from '../common/non-retryable-error';
import { like } from '../common/util';
import { Config } from '../config';
import { GradingBotSsmConfig } from '../integrations/ssm';
import { GradingTaskDocument } from '../model/grading-task';

import { PromptExecutionTask, PromptExecutionTaskDocument } from '../model/prompt-execution-task';
import { extractContent } from './extract-content';

const log = Logger.create('sm-response');

export async function prepareSMResponsesPrompt(
  task: GradingTaskDocument,
  config: GradingBotSsmConfig,
  logContext?: GradingBotLoggingContext,
): Promise<PromptExecutionTaskDocument[]> {
  if (task.submission == null || task.submission.length === 0) {
    throw new NonRetryableError(`Submission is empty`);
  }

  log.info(`Preparing sm response prompts for task`, logContext);
  // Uses structured prompt
  const systemPromptTemplate = Handlebars.compile(config.prompts.structuredSystem, { noEscape: true });
  const userPromptTemplate = Handlebars.compile(config.prompts.structuredUser, { noEscape: true });

  // For every grading rule generate a separate grading task
  const result: PromptExecutionTaskDocument[] = [];
  for (const rule of task.rules) {
    // Identify questions applicable to this grading rule
    let contents = task.submission.filter((qna) => {
      // This rule is not related to the specific question, just return all questions
      if (rule.smKeyNamePattern == null) {
        return true;
      }
      // Related to the specific question, perform matching
      return like(qna.question, rule.smKeyNamePattern);
    });

    // Perform content extraction
    contents = await extractContent(contents, rule, logContext);

    const context = {
      contents,
      rule,
    };

    const systemPrompt = systemPromptTemplate(context);
    const userPrompt = userPromptTemplate(context);

    log.plain('SM_RESPONSE_GRADING_SYSTEM_PROMPT', systemPrompt);
    log.plain('SM_RESPONSE_GRADING_USER_PROMPT', userPrompt);

    result.push(
      PromptExecutionTask.newDocumentWithPromptFor(systemPrompt, userPrompt, task, {
        id: rule.id, // We use rule id as key to override pre-existing tasks in case we will do re-processing
        relatedId: rule.id,
        config: {
          model: rule.model ?? Config.getDefaultModel(),
        },
        logContext,
      }),
    );
  }

  return result;
}
