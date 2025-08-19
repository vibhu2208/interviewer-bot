import { Logger } from '../common/logger';
import { AppSync } from '../integrations/appsync';
import { SqsGptMatchingInterviewUserMessage } from '../integrations/sqs';
import { Question } from '../model/question';
import { Session } from '../model/session';
import { MatchingInterviewService } from '../services/matching-interview.service';

const log = Logger.create('gptMatchingInterviewUserMessage');

/**
 * Handles SQS messages for processing a user's message during a matching interview.
 * Fetches necessary data, delegates processing to MatchingInterviewService,
 * and handles error reporting.
 */
export async function gptMatchingInterviewUserMessage(message: SqsGptMatchingInterviewUserMessage): Promise<void> {
  const logContext = log.context(message);
  try {
    const question = await Question.getById(message.sessionId, message.questionId, true);
    const session = await Session.getById(message.sessionId);
    if (question == null || session == null) {
      throw new Error(`Want to generate next matching interview question but Question or Session is null`);
    }

    const flowService = new MatchingInterviewService();
    await flowService.generateAssistantResponse(question, session);

    log.info('Matching interview message processed successfully', logContext);
  } catch (e: any) {
    log.error(`Error while processing matching interview conversation`, e, log.context(message));

    await AppSync.triggerAnswerAttempted({
      sessionId: message.sessionId,
      questionId: message.questionId,
      error: e.message,
      state: 'Completed',
      result: '',
    });

    if (e.message?.includes('Please reduce the length of the messages or functions')) {
      log.info(`Encountered GPT token limit error, updating question error`, logContext);
      await Question.updateError(message.sessionId, message.questionId, 'TokenLimit');
      return;
    }
    throw e;
  }
}
