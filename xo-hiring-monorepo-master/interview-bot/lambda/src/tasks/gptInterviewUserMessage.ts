import { Logger } from '../common/logger';
import { AppSync } from '../integrations/appsync';
import { SqsGptInterviewUserMessage } from '../integrations/sqs';
import { CalibratedQuestion } from '../model/calibrated-question';
import { Question } from '../model/question';
import { Session } from '../model/session';
import { InterviewQuestionFlowService } from '../services/interview-question-flow.service';

const log = Logger.create('gptInterviewUserMessage');

/**
 * Handles SQS messages for processing a user's message during an interview.
 * Fetches necessary data, delegates processing to InterviewQuestionFlowService,
 * and handles error reporting.
 */
export async function gptInterviewUserMessage(message: SqsGptInterviewUserMessage): Promise<void> {
  const logContext = log.context(message);
  try {
    const question = await Question.getById(message.sessionId, message.questionId, true);
    const session = await Session.getById(message.sessionId);
    if (question == null || session == null) {
      throw new Error(`Want to generate next interview question but Question or Session is null`);
    }

    const calibratedQuestion = await CalibratedQuestion.getById(session.skillId, question.id);
    if (calibratedQuestion == null) {
      throw new Error(`Want to generate next interview question but CalibratedQuestion is null`);
    }

    const flowService = new InterviewQuestionFlowService();
    await flowService.generateAssistantResponse(question, session, calibratedQuestion, message.forceGrading);
  } catch (e: any) {
    log.error(`Error while processing interview conversation`, e, log.context(message));

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
