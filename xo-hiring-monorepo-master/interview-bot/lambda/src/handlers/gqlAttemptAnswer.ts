import { AppSyncResolverEvent } from 'aws-lambda/trigger/appsync-resolver';
import { Logger } from '../common/logger';
import { Question } from '../model/question';
import { Session } from '../model/session';
import { Skill } from '../model/skill';
import { createQuestionFlowService } from '../services/question-flow-service.factory';

const log = Logger.create('gqlAttemptAnswer');

interface AttemptAnswerArguments {
  sessionId: string;
  questionId: string;
  answer: string;
}

interface OperationResult {
  error: string | null;
}

export async function handler(event: AppSyncResolverEvent<AttemptAnswerArguments>): Promise<OperationResult> {
  log.plain('EVENT', event);

  // Fetch related data
  const session = await Session.getById(event.arguments.sessionId);
  const question = await Question.getById(event.arguments.sessionId, event.arguments.questionId);

  if (session == null || question == null) {
    log.warn(`Cannot fetch session/question`, log.context(event.arguments));
    return {
      error: `Cannot find specified session or question`,
    };
  }

  const skill = await Skill.getById(session.skillId);
  if (skill == null) {
    log.warn(`Cannot fetch skill`, log.context(event.arguments));
    return {
      error: `Cannot find specified skill`,
    };
  }

  const maxAttempts = question.promptSettings?.maxAttempts ?? 0;
  const currentAttempt = (question.answerAttempts ?? 0) + 1;
  if (maxAttempts > 0 && currentAttempt > maxAttempts) {
    log.info(`Max attempts reached (${currentAttempt} > ${maxAttempts})`, log.context(event.arguments));
    return {
      error: `Exceeded attempts limit`,
    };
  }

  const firstInterviewCall = skill.mode === 'interview' && question.conversation == null;

  const answerLength = event.arguments.answer?.length ?? 0;
  if (answerLength === 0 && !firstInterviewCall) {
    log.info(`Empty input provided as an answer`, log.context(event.arguments));
    return {
      error: `Empty input provided`,
    };
  }
  if (question.answerMaxSize != null && answerLength > question.answerMaxSize) {
    log.info(`Answer is too long (${answerLength} > ${question.answerMaxSize})`, log.context(event.arguments));
    return {
      error: `Answer is too long`,
    };
  }

  try {
    const flowService = createQuestionFlowService(skill, session);

    await flowService.processAnswerAttempt(event.arguments.answer, question, session, currentAttempt);

    return {
      error: null,
    };
  } catch (error: any) {
    log.error(`Error processing answer attempt`, error, log.context(event.arguments));
    return {
      error: error.message || 'An unexpected error occurred processing the answer.',
    };
  }
}
