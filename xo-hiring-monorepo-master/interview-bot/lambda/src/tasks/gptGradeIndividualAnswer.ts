import Handlebars from 'handlebars';
import { z } from 'zod';
import { Logger } from '../common/logger';
import { SessionContext, SessionContextData } from '../common/session-context';
import { LLMProjectName } from '../config';
import { DynamoDB } from '../integrations/dynamodb';
import { SqsGptGradeIndividualAnswerMessage } from '../integrations/sqs';
import { Question, QuestionDocument } from '../model/question';
import { Session } from '../model/session';
import { gptCheckAnswerForCheating } from './gptCheckAnswerForCheating';
import { generateObject } from 'ai';
import { Llm } from '@trilogy-group/xoh-integration';
import { performFraudCheck } from './performFraudCheck';

const log = Logger.create('gptGradeIndividualAnswer');

const GradingWithGradingRulesSchema = z.object({
  summary: z.string().describe('Explain the reasoning for your grading, no more than 300 characters'),
  rulesMatched: z
    .array(z.number())
    .describe('An array of numbers representing the indexes (starting from 0) of the rules matched'),
});
type GradingWithGradingRules = z.infer<typeof GradingWithGradingRulesSchema>;

const GradeIndividualFunctionSchema = z.object({
  index: z.number().describe('Index of the question (in the order they appear)'),
  correctness: z.number().describe('Correctness grading score (from 0 to 10)'),
  depth: z.number().optional().describe('Depth grading score (from 0 to 10)'),
  correctnessGrading: z
    .string()
    .describe('Explain what could have improved the correctness score, no more than 300 characters'),
  depthGrading: z
    .string()
    .optional()
    .describe('Explain what could have improved the depth score, no more than 300 characters'),
});
type GradeBulkGradingElement = z.infer<typeof GradeIndividualFunctionSchema>;

export async function gptGradeIndividualAnswer(message: SqsGptGradeIndividualAnswerMessage): Promise<void> {
  const context = await SessionContext.fetch(message.sessionId, false);
  if (!context) {
    return;
  }

  if (context.session.state !== 'Completed') {
    log.warn(`Session state is not Completed: ${context.session.state}, skipping grading`, log.context(message));
    return;
  }

  const question = await Question.getById(message.sessionId, message.questionId);
  if (question == null) {
    log.error(`Want to do individual grading but Question is null`, log.context(message));
    return;
  }

  if (question.answer == null || question.answer.trim().length === 0) {
    question.answer = 'No answer provided';
    question.correctnessGrading = {
      score: 0,
      summary: 'No answer provided',
    };

    await DynamoDB.putDocument(question);
    await Session.incrementGradedQuestionsCounter(message.sessionId);

    log.info(`Skipping grading for prompt-engineering question due to missing answer`, log.context(message), {
      question,
    });
    return;
  }

  context.question = question;

  const cheatingCheck = await gptCheckAnswerForCheating(context, log.context(message));
  question.cheatingCheckRegex = cheatingCheck.cheatingCheckRegex;
  question.cheatingCheck = cheatingCheck.cheatingCheck;

  if (cheatingCheck.overallResult?.cheated !== 'yes') {
    await performFraudCheck(context.session, question, question.answer, log.context(message));

    await doGrading(message, context, question);
  } else {
    // Fill the scores for cheating answer
    question.correctnessGrading = {
      score: 0,
      summary: cheatingCheck.overallResult.summary,
    };
  }

  // We're just overwriting them for now. Should not lose any info
  await DynamoDB.putDocument(question);

  // Update session counter for graded answers
  await Session.incrementGradedQuestionsCounter(message.sessionId);

  log.info(
    `Answer graded successfully (correctness=${question.correctnessGrading?.score}, depth=${question.depthGrading?.score})`,
    log.context(message),
  );
}

export async function doGrading(
  message: SqsGptGradeIndividualAnswerMessage,
  context: SessionContextData,
  question: QuestionDocument,
) {
  log.info(`Performing grading of the answer (generating prompts)`, log.context(message));

  // Generate prompts using handlebars first
  const gradingSystemPromptTemplate = Handlebars.compile(context.questionGenerator.gradingPrompt.system, {
    noEscape: true,
  });
  const gradingUserPromptTemplate = Handlebars.compile(context.questionGenerator.gradingPrompt.user, {
    noEscape: true,
  });

  const gradingSystemPrompt = gradingSystemPromptTemplate(context);
  const gradingUserPrompt = gradingUserPromptTemplate(context);

  log.plain('GRADING_SYSTEM_PROMPT', gradingSystemPrompt);
  log.plain('GRADING_USER_PROMPT', gradingUserPrompt);

  // Determine the grading type to use based on the presence of grading rules
  const gradingType = (question.gradingRules?.length ?? 0) > 0 ? 'grading-rules' : 'individual-grading';
  const schema: z.Schema =
    gradingType === 'grading-rules' ? GradingWithGradingRulesSchema : GradeIndividualFunctionSchema;

  // Obtain the model instance via the Llm integration
  const model = await Llm.getDefaultModel(LLMProjectName);

  // Use structured output generation instead of tool calling.
  const { object } = await generateObject({
    model,
    schema,
    schemaDescription: 'Grade answer provided by the candidate',
    system: gradingSystemPrompt,
    prompt: gradingUserPrompt,
    temperature: 0,
  });

  log.info(`Structured output from grading function '${gradingType}'`, log.context(message), { data: object });

  if (gradingType === 'grading-rules') {
    const gradingRulesData = object as GradingWithGradingRules;
    // Map rulesMatched to the grading rules by index
    const matchedRules = gradingRulesData.rulesMatched.map((index) => question.gradingRules?.[index] ?? null);
    log.info(`Matched ${matchedRules.length} rules`, log.context(message), {
      matchedRules,
    });
    // Sum the scores of the matched rules
    const totalScore = matchedRules.reduce((total, rule) => total + (rule?.score ?? 0), 0);
    question.correctnessGrading = {
      score: totalScore,
      summary: gradingRulesData.summary,
    };
  } else {
    const singleGradingData = object as GradeBulkGradingElement;
    // Set the individual grading scores accordingly
    question.correctnessGrading = {
      score: singleGradingData.correctness,
      summary: singleGradingData.correctnessGrading,
    };
    question.depthGrading = {
      score: singleGradingData.depth,
      summary: singleGradingData.depthGrading,
    };
  }
}
