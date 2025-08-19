import { Logger } from '../common/logger';
import { AppSync } from '../integrations/appsync';
import { SqsGptAttemptUserPromptMessage } from '../integrations/sqs';
import { Question } from '../model/question';
import { PromptEngineeringQuestionFlowService } from '../services/prompt-engineering-question-flow.service';

const log = Logger.create('gptAttemptUserPrompt');

/**
 * Handles SQS message for evaluating a user prompt in prompt-engineering mode.
 * Delegates core logic to PromptEngineeringQuestionFlowService.
 */
export async function gptAttemptUserPrompt(message: SqsGptAttemptUserPromptMessage): Promise<void> {
  const logContext = log.context(message);
  const question = await Question.getById(message.sessionId, message.questionId);
  if (question == null) {
    log.error(`Want to attempt prompt evaluation but Question is null`, logContext);
    return;
  }

  try {
    const flowService = new PromptEngineeringQuestionFlowService();
    await flowService.evaluateAndCheckPrompt(message.sessionId, message.questionId, message.prompt, question);
  } catch (e: any) {
    log.error(`Error while executing candidate prompt`, e, log.context(message));

    await AppSync.triggerAnswerAttempted({
      sessionId: message.sessionId,
      questionId: message.questionId,
      error: e.message,
    });

    throw e;
  }
}
