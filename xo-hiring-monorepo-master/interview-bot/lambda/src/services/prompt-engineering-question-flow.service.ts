import { z } from 'zod';
import { generateObject } from 'ai';
import { DEFAULT_LLM_DEFINITION, Llm } from '@trilogy-group/xoh-integration';
import { InterviewBotLoggingContext, Logger } from '../common/logger';
import { SessionContext } from '../common/session-context';
import { modelNameToDefinition } from '../common/util';
import { AppSync, AnswerAttemptResult } from '../integrations/appsync';
import { Sqs } from '../integrations/sqs';
import { Question, QuestionDocument } from '../model/question';
import { SessionDocument } from '../model/session';
import { CheatingCheckResult, gptCheckAnswerForCheating } from '../tasks/gptCheckAnswerForCheating';
import { QuestionFlowService } from './question-flow.service';

const log = Logger.create('PromptEngineeringQuestionFlowService');

const EvaluatePromptSchema = z.object({
  response: z.string().describe('Your response to the user prompt. Be direct and to the point.'),
});

export class PromptEngineeringQuestionFlowService extends QuestionFlowService {
  async processAnswerAttempt(
    answer: string,
    question: QuestionDocument,
    session: SessionDocument,
    currentAttempt: number,
  ): Promise<void> {
    const logContext = log.context({ sessionId: session.id, questionId: question.id });
    const answerLength = answer?.length ?? 0;
    const maxAttempts = question.promptSettings?.maxAttempts ?? 0;

    const sessionId = session.id;
    const questionId = question.id;

    await Question.updateAnswerAndAttempt(sessionId, questionId, answer, currentAttempt);

    log.info(
      `User attempt prompt evaluation (${answerLength} characters length, attempt ${currentAttempt}/${maxAttempts})`,
      logContext,
    );

    await Sqs.sendGptMessage({
      type: 'attempt-user-prompt',
      questionId: questionId,
      sessionId: sessionId,
      prompt: answer,
    });
  }

  async evaluateAndCheckPrompt(
    sessionId: string,
    questionId: string,
    prompt: string,
    question: QuestionDocument,
  ): Promise<void> {
    const logContext = log.context({ sessionId, questionId });

    const [promptEvaluation, cheatingCheck] = await Promise.all([
      this.evaluatePromptInternal(sessionId, questionId, prompt, question, logContext),
      this.checkCheatingInternal(sessionId, question, logContext),
    ]);

    const validAnswer = cheatingCheck?.overallResult?.cheated !== 'yes';

    const updatePayload: AnswerAttemptResult = {
      sessionId: sessionId,
      questionId: questionId,
      attempts: question.answerAttempts,
      result: promptEvaluation,
      validAnswer,
    };
    await AppSync.triggerAnswerAttempted(updatePayload);
  }

  private async checkCheatingInternal(
    sessionId: string,
    question: QuestionDocument,
    logContext: InterviewBotLoggingContext,
  ): Promise<CheatingCheckResult | null> {
    const context = await SessionContext.fetch(sessionId);
    if (context == null) {
      log.warn(`Cannot fetch session context to perform cheating check`, logContext);
      return null;
    }

    context.question = question;
    return await gptCheckAnswerForCheating(context, logContext);
  }

  private async evaluatePromptInternal(
    sessionId: string,
    questionId: string,
    prompt: string,
    question: QuestionDocument,
    logContext: InterviewBotLoggingContext,
  ): Promise<string> {
    log.plain('CANDIDATE_ATTEMPT_USER_PROMPT', prompt, logContext);

    const llmDef = modelNameToDefinition(question.promptSettings?.model ?? DEFAULT_LLM_DEFINITION.model);
    const model = await Llm.getModel(llmDef);

    if (prompt.trim().length === 0) {
      prompt = '-';
    }

    const { object } = await generateObject({
      prompt: prompt,
      schema: EvaluatePromptSchema,
      temperature: 0,
      model,
    });

    if (!object) {
      throw new Error(`GPT responded with null output`);
    }

    await Question.updatePromptResult(sessionId, questionId, object.response);

    return object.response;
  }
}
