import Handlebars from 'handlebars';
import { generateObject } from 'ai';
import { z } from 'zod';
import { InterviewBotLoggingContext, Logger } from '../common/logger';
import { NonRetryableError } from '../common/non-retryable-error';
import { SessionContext, SessionContextData } from '../common/session-context';
import { LLMProjectName } from '../config';
import { DynamoDB } from '../integrations/dynamodb';
import { SqsGptPrepareSessionMessage } from '../integrations/sqs';
import { Llm } from '@trilogy-group/xoh-integration';
import { CalibratedQuestionDocument, ValidStatuses } from '../model/calibrated-question';
import { Question } from '../model/question';
import { Session } from '../model/session';

const log = Logger.create('gptPrepareQuestionsForSession');

const ResponseSchema = z.object({
  selectedQuestions: z
    .array(z.number())
    .describe('Array of indices representing selected questions from the available questions pool'),
});

export async function gptPrepareQuestionsForSession(message: SqsGptPrepareSessionMessage): Promise<void> {
  const logContext = log.context(message);
  const context = await SessionContext.fetch(message.sessionId, false, true);
  if (!context) {
    return;
  }

  log.info(`Preparing questions for session`, logContext);

  // Only pick certain type of questions
  context.calibratedQuestions = context.calibratedQuestions.filter((it) => ValidStatuses.includes(it.status));
  log.info(`${context.calibratedQuestions.length} calibrated questions available`, logContext);
  log.plain(`AVAILABLE_CALIBRATED_QUESTIONS`, context.calibratedQuestions);

  let pickedQuestions: CalibratedQuestionDocument[];
  if (context.calibratedQuestions.length === context.skill.questionsPerSession) {
    log.info(
      `Exactly ${context.skill.questionsPerSession} calibrated questions are available, picking all of them`,
      logContext,
    );
    pickedQuestions = context.calibratedQuestions;
  } else {
    log.info(
      `Picking ${context.skill.questionsPerSession} calibrated questions out of ${context.calibratedQuestions.length} with GPT`,
      logContext,
    );
    pickedQuestions = await pickQuestionsWithGPT(message, context, logContext);
  }

  const questions = pickedQuestions.map((it) =>
    Question.newDocument(message.sessionId, it.id, {
      question: it.question,
      perfectAnswer: it.perfectAnswer,
      questionId: it.id,
      gradingRubric: it.gradingRubric,
      promptSettings: it.promptSettings,
      defaultAnswer: it.defaultAnswer,
      answerMaxSize: it.answerMaxSize,
      cheatingRubric: it.cheatingRubric,
      status: it.status,
      cheatingPatterns: it.cheatingPatterns,
      gradingRules: it.gradingRules,
      dimensions: it.dimensions,
    }),
  );

  // Store questions and update session state
  await DynamoDB.putDocuments(questions);
  await Session.setStateToReady(message.sessionId, questions.length);

  log.info(`Questions prepared, session is ready`, logContext);
}

async function pickQuestionsWithGPT(
  message: SqsGptPrepareSessionMessage,
  context: SessionContextData,
  logContext: InterviewBotLoggingContext,
): Promise<CalibratedQuestionDocument[]> {
  const selectorSystemPromptTemplate = Handlebars.compile(context.questionGenerator.selectorPrompt.system);
  const selectorUserPromptTemplate = Handlebars.compile(context.questionGenerator.selectorPrompt.user);

  const selectorSystemPrompt = selectorSystemPromptTemplate(context);
  const selectorUserPrompt = selectorUserPromptTemplate(context);

  log.plain('SELECTOR_SYSTEM_PROMPT', selectorSystemPrompt);
  log.plain('SELECTOR_USER_PROMPT', selectorUserPrompt);

  try {
    const { object } = await generateObject({
      model: await Llm.getDefaultModel(LLMProjectName),
      schema: ResponseSchema,
      system: selectorSystemPrompt,
      prompt: selectorUserPrompt,
      temperature: 0.5,
      schemaDescription: `Select ${context.skill.questionsPerSession} questions from the available pool of questions`,
    });

    log.info(`LLM picked question indices: ${object.selectedQuestions}`, logContext);

    // Validate indices are within bounds
    const invalidIndices = object.selectedQuestions.filter(
      (index) => index < 0 || index >= context.calibratedQuestions.length,
    );

    if (invalidIndices.length > 0) {
      throw new Error(`GPT returned invalid question indices: ${invalidIndices.join(', ')}`);
    }
    if (object.selectedQuestions.length != context.skill.questionsPerSession) {
      throw new Error('GPT did not return the expected number of questions');
    }

    return object.selectedQuestions.map((index) => context.calibratedQuestions[index]);
  } catch (error) {
    const errorMessage = (error as Error).message;
    const countRetries = message.errors?.filter((it) => it.includes(errorMessage)).length ?? 0;

    if (countRetries < 3) {
      throw error;
    } else {
      await Session.setError(context.session.id, 'CannotPickQuestions');
      throw new NonRetryableError(errorMessage);
    }
  }
}
