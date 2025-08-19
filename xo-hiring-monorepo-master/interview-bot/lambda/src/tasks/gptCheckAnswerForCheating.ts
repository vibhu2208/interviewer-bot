import Handlebars from 'handlebars';
import { z } from 'zod';
import { generateObject } from 'ai';
import { Llm } from '@trilogy-group/xoh-integration';
import { InterviewBotLoggingContext, Logger } from '../common/logger';
import { SessionContextData } from '../common/session-context';
import { LLMProjectName } from '../config';
import { CheatingCheck, QuestionDocument } from '../model/question';

const log = Logger.create('gptCheckAnswerForCheating');

export type CheatingCheckResult = Pick<QuestionDocument, 'cheatingCheck' | 'cheatingCheckRegex'> & {
  overallResult: CheatingCheck | null;
};

const CheatingCheckSchema = z.object({
  summary: z.string().describe('A brief summary of why the answer was flagged as cheating or not'),
  cheated: z.enum(['yes', 'no']).describe('Whether the answer appears to be cheating'),
  checksFailed: z.number().optional().describe('Number of failed checks'),
});

/**
 * Not a standalone task yet, expected to be called from other tasks
 * Perform a call to GPT to check answer for the cheating based on the cheatingPrompt (if defined)
 * And/Or determine cheating based on regex patterns (if defined)
 * Expects context to have a single defined question
 * The result is & of all checks (if any is yes then yes, otherwise no) as well as potential question update
 * The question entity is not updated here
 *
 * @param context prompt context (context.questionGenerator.cheatingPrompt should be defined, context.question.cheatingRubric should be defined)
 * @param logContext logging context
 * @return either result or null if no check has been performed
 */
export async function gptCheckAnswerForCheating(
  context: SessionContextData,
  logContext: InterviewBotLoggingContext,
): Promise<CheatingCheckResult> {
  // Do all cheating checks in parallel
  const [resultPrompt, resultRegex] = await Promise.all([
    performPromptBasedCheatingCheck(context, logContext),
    performRegexBasedCheatingCheck(context, logContext),
  ]);

  const detections: string[] = [];
  if (resultPrompt?.cheated === 'yes') {
    detections.push('prompt-based');
  }
  if (resultRegex?.cheated === 'yes') {
    detections.push('regex-based');
  }

  let overallResult: CheatingCheck | null = null;
  if (detections.length > 0) {
    overallResult = {
      cheated: 'yes',
      summary: `Cheating detected (${detections.join(', ')})`,
    };
  }

  return {
    cheatingCheck: resultPrompt ?? undefined,
    cheatingCheckRegex: resultRegex ?? undefined,
    overallResult,
  };
}

export async function performRegexBasedCheatingCheck(
  context: SessionContextData,
  logContext: InterviewBotLoggingContext,
): Promise<CheatingCheck | null> {
  if (context.question?.cheatingPatterns == null || context.question.cheatingPatterns.length === 0) {
    log.info(`Skipping regex cheating check: cheatingPatterns are not filled`, logContext);
    return null;
  }

  if (context.question.answer == null) {
    log.info(`Skipping regex cheating check: answer is empty`, logContext);
    return null;
  }

  log.info(`Performing regex cheating check of the answer`, logContext);

  let cheatingCheckResult: CheatingCheck | null = null;
  const failedPatterns: string[] = [];
  for (const pattern of context.question.cheatingPatterns) {
    const regex = new RegExp(pattern, 'gmi');
    if (regex.test(context.question.answer)) {
      failedPatterns.push(pattern);
    }
  }

  if (failedPatterns.length > 0) {
    cheatingCheckResult = {
      cheated: 'yes',
      summary: `Failed regex patterns: ${failedPatterns.map((it) => `'${it}'`).join(', ')}`,
      checksFailed: failedPatterns.length,
    };
  }

  log.info(`regex cheating check result`, logContext, { result: cheatingCheckResult });

  return cheatingCheckResult;
}

async function performPromptBasedCheatingCheck(
  context: SessionContextData,
  logContext: InterviewBotLoggingContext,
): Promise<CheatingCheck | null> {
  if (context.questionGenerator.cheatingPrompt == null) {
    log.info(`Skipping prompt cheating check: questionGenerator.cheatingPrompt is not defined`, logContext);
    return null;
  }

  if (context.question?.cheatingRubric == null) {
    log.info(`Skipping prompt cheating check: question.cheatingRubric is not defined`, logContext);
    return null;
  }

  log.info(`Performing prompt cheating check of the answer (generating prompts)`, logContext);

  // Generate prompts using handlebars first
  const cheatingSystemPromptTemplate = Handlebars.compile(context.questionGenerator.cheatingPrompt.system, {
    noEscape: true,
  });
  const cheatingUserPromptTemplate = Handlebars.compile(context.questionGenerator.cheatingPrompt.user, {
    noEscape: true,
  });

  const gradingSystemPrompt = cheatingSystemPromptTemplate(context);
  const gradingUserPrompt = cheatingUserPromptTemplate(context);

  log.plain('CHEATING_SYSTEM_PROMPT', gradingSystemPrompt);
  log.plain('CHEATING_USER_PROMPT', gradingUserPrompt);

  const model = await Llm.getDefaultModel(LLMProjectName);

  const { object } = await generateObject({
    system: gradingSystemPrompt,
    prompt: gradingUserPrompt,
    schema: CheatingCheckSchema,
    temperature: 0,
    model,
  });

  if (!object) {
    throw new Error(`GPT responded with null output`);
  }

  log.info(`GPT function called with arguments`, logContext, { arguments: object });

  return object;
}
