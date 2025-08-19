import Handlebars from 'handlebars';
import { z } from 'zod';
import { generateObject } from 'ai';
import { Llm } from '@trilogy-group/xoh-integration';
import { Logger } from '../common/logger';
import { DynamoDB } from '../integrations/dynamodb';
import { SqsGenerateCalibratedQuestionsMessage } from '../integrations/sqs';
import { CalibratedQuestion } from '../model/calibrated-question';
import { QuestionGenerator } from '../model/question-generator';
import { Skill } from '../model/skill';
import { LLMProjectName } from '../config';

const log = Logger.create('gptGenerateCalibratedQuestions');

const GptGeneratedQuestionSchema = z.object({
  index: z.number(),
  level: z.enum(['Easy', 'Typical', 'Difficult']),
  question: z.string(),
  perfectAnswer: z.string(),
  gradingRubric: z.string().optional(),
});

const GenerateCalibratedQuestionsSchema = z.object({
  questions: z.array(GptGeneratedQuestionSchema),
});

export type GptGeneratedQuestion = z.infer<typeof GptGeneratedQuestionSchema>;

/**
 * Generate calibrated questions that should be verified manually later
 */
export async function gptGenerateCalibratedQuestions(message: SqsGenerateCalibratedQuestionsMessage): Promise<void> {
  if (message.skillId == null) {
    log.error(`Generating calibrated questions but skillId is not defined`, log.context(message));
    return;
  }

  const skill = await Skill.getById(message.skillId);
  if (skill == null) {
    log.error(`Generating calibrated questions but Skill is null`, log.context(message));
    return;
  }

  const questionGenerator = await QuestionGenerator.getById(skill.generatorId);
  if (questionGenerator == null) {
    log.error(`Generating calibrated questions but QuestionGenerator is null`, log.context(message));
    return;
  }

  log.info(`Generating calibrated questions`, log.context(message));

  const context = {
    questionsCount: message.questionsCount ?? 5,
    skill,
    questionGenerator,
  };

  // Generate prompts using handlebars first
  const questionSystemPromptTemplate = Handlebars.compile(context.questionGenerator.questionPrompt.system);
  const questionUserPromptTemplate = Handlebars.compile(context.questionGenerator.questionPrompt.user);

  const questionSystemPrompt = questionSystemPromptTemplate(context);
  const questionUserPrompt = questionUserPromptTemplate(context);

  log.plain('GENERATE_CALIBRATED_QUESTION_SYSTEM_PROMPT', questionSystemPrompt);
  log.plain('GENERATE_CALIBRATED_QUESTION_USER_PROMPT', questionUserPrompt);

  const model = await Llm.getDefaultModel(LLMProjectName);

  const { object } = await generateObject({
    system: questionSystemPrompt,
    prompt: questionUserPrompt,
    schema: GenerateCalibratedQuestionsSchema,
    temperature: 0,
    model,
  });

  if (!object) {
    throw new Error(`GPT responded with null output`);
  }

  log.info(`Generated ${object.questions.length} calibrated questions`, log.context(message));

  const questions = object.questions.map((it) =>
    CalibratedQuestion.newDocument(message.skillId, {
      question: it.question,
      perfectAnswer: it.perfectAnswer,
      level: it.level,
      status: message.targetStatus ?? 'Review',
      gradingRubric: it.gradingRubric,
    }),
  );

  // Store questions
  await DynamoDB.putDocuments(questions);

  log.info(`Calibrated questions successfully generated`, log.context(message));
}
