import { DynamoDBStreamEvent } from 'aws-lambda';
import { InterviewBotLoggingContext, Logger } from '../common/logger';
import { ScoreCalculation } from '../common/score-calculation';
import { SessionContext } from '../common/session-context';
import { Config } from '../config';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';
import { Sqs, SqsGptCheckSessionExpirationMessage } from '../integrations/sqs';
import { StepFunctions } from '../integrations/step-functions';
import { Question } from '../model/question';
import { isSessionDocument, Session, SessionDocument } from '../model/session';
import { Skill, SkillDocument } from '../model/skill';
import { InterviewQuestionFlowService } from '../services/interview-question-flow.service';
import { ObservabilityService } from '../services/observability.service';
import { ABTestingService } from '../services/ab-testing.service';
import { MatchingInterviewGradingService } from '../services/matching-interview-grading.service';

const log = Logger.create('processDdbStream');

const ProblematicQuestionsDetected = 'Detected problematic questions, grading score is not sent';

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const promises = [];
  for (const record of event.Records) {
    if (record.eventName === 'MODIFY') {
      const newDocument = DynamoDB.unmarshall<MainTableKeys>(record.dynamodb?.NewImage);
      const oldDocument = DynamoDB.unmarshall<MainTableKeys>(record.dynamodb?.OldImage);

      // Detect Session change
      if (isSessionDocument(newDocument) && isSessionDocument(oldDocument)) {
        // Session state change
        if (oldDocument.state !== newDocument.state) {
          switch (newDocument.state) {
            case 'Started':
              promises.push(onSessionStarted(newDocument));
              break;
            case 'Completed':
              promises.push(onSessionCompleted(newDocument));
              break;
            case 'Graded':
              promises.push(onSessionGraded(newDocument));
              break;
          }
        }

        // Session individual question grading changed
        if (
          newDocument.totalQuestionsCount != null &&
          newDocument.gradedQuestionsCount != null &&
          newDocument.gradedQuestionsCount !== oldDocument.gradedQuestionsCount &&
          newDocument.totalQuestionsCount === newDocument.gradedQuestionsCount
        ) {
          promises.push(handleGradingDoneForIndividualQuestions(newDocument));
        }
      }
    }
  }

  await Promise.all(promises);
}

async function onSessionCompleted(sessionDocument: SessionDocument): Promise<void> {
  const logContext = { sessionId: sessionDocument.id };
  log.info(`Session state changed to Completed`, logContext);

  // Track session completed for A/B test monitoring
  if (sessionDocument.experiment_group && sessionDocument.error !== 'Abandoned') {
    await ObservabilityService.trackSessionCompleted(sessionDocument.experiment_group, sessionDocument.skillId);

    // Track session duration if both start and end times are available
    if (sessionDocument.startTime && sessionDocument.endTime) {
      const durationMs = new Date(sessionDocument.endTime).getTime() - new Date(sessionDocument.startTime).getTime();
      await ObservabilityService.trackSessionDuration(
        sessionDocument.experiment_group,
        sessionDocument.skillId,
        durationMs,
      );
    }
  }

  const skill = await Skill.getById(sessionDocument.skillId);
  if (skill == null) {
    log.error(`Cannot fetch referenced Skill with id ${sessionDocument.skillId}`, logContext);
    return;
  }
  const mode = skill.mode ?? 'free-response';

  if (sessionDocument.error === 'Abandoned') {
    if (mode === 'interview') {
      // We want to handle a case with interview not being graded due to function not being called
      const shouldProceedWithGrading = await checkInterviewFlowShouldForceGrade(sessionDocument, logContext);
      if (!shouldProceedWithGrading) {
        log.info(
          'Detected state change for Abandoned session, positive grading is not available, sending negative status event',
          logContext,
        );
        await Session.sendStatusEventSessionError(
          sessionDocument,
          'Session is abandoned (no positive grading for interview)',
        );
        return;
      }
    } else {
      log.info('Detected state change for Abandoned session, sending negative status event', logContext);
      await Session.sendStatusEventSessionError(sessionDocument, 'Session is abandoned');
      return;
    }
  }

  switch (mode) {
    case 'interview':
      await gradeInterviewSkillQuestions(sessionDocument);
      break;
    case 'free-response':
    case 'prompt-engineering':
      log.info(`Sending grade answers message for '${skill.mode}'`, logContext);
      await triggerIndividualQuestionGrading(sessionDocument, skill);
      break;
    default:
      log.warn(`Unknown skill processing mode: ${mode}`, logContext);
  }

  // Send status event for all modes except interview
  // The interview mode will send the event on its own
  if (mode != 'interview') {
    await Session.sendStatusEvent(sessionDocument);
  }
}

async function onSessionGraded(sessionDocument: SessionDocument): Promise<void> {
  log.info(`Session state changed to Graded, sending status event message`, { sessionId: sessionDocument.id });

  // Track session graded for A/B test monitoring
  if (sessionDocument.experiment_group) {
    await ObservabilityService.trackSessionGraded(sessionDocument.experiment_group, sessionDocument.skillId);
  }

  try {
    if (sessionDocument.grading?.summary === ProblematicQuestionsDetected) {
      log.info(`Not sending grading status event because problematic questions have been detected`, {
        sessionId: sessionDocument.id,
      });
      return;
    }
    // Send status event
    await Session.sendStatusEvent(sessionDocument);
  } catch (e) {
    log.error(`Error while sending status event`, e, { sessionId: sessionDocument.id });
  }
}

async function onSessionStarted(sessionDocument: SessionDocument): Promise<void> {
  const logContext = { sessionId: sessionDocument.id };
  log.info(`Session state changed to Started, starting step machine execution to check session end`, logContext);

  // Track session started for A/B test monitoring
  if (sessionDocument.experiment_group) {
    await ObservabilityService.trackSessionStarted(sessionDocument.experiment_group, sessionDocument.skillId);
  }

  try {
    // Calculate when the session should end
    let delayInSeconds = (sessionDocument.durationLimit ?? Config.getDefaultSessionDuration()) * 60;
    // If session is not timeboxed, we should multiply it by configured amount
    if (!sessionDocument.isTimeboxed) {
      delayInSeconds *= Config.getNonTimeboxedSessionDurationMultiplier();
    } else {
      // Otherwise add 1 minute to make sure frontend handled expiration on it's end (if still opened)
      delayInSeconds += 60;
    }
    log.info(
      `Session timeboxed: ${sessionDocument.isTimeboxed}, final expiration delay is ${delayInSeconds} seconds`,
      logContext,
    );

    const sqsMessage: SqsGptCheckSessionExpirationMessage = {
      type: 'check-session-expiration',
      sessionId: sessionDocument.id,
    };

    // Send status event
    await StepFunctions.sendDelayedQueueMessage(
      `${sessionDocument.id}_sessionEndCheck_${Date.now()}`,
      Config.getGptQueueUrl(),
      sqsMessage,
      delayInSeconds,
    );
  } catch (e) {
    log.error(`Error while starting step machine`, e, logContext);
  }
}

/**
 * Attempt to force-grade legacy matching interview questions.
 * If the overall expected session grading score if gte threshold, return true to proceed with session grading.
 * Does not update session grading.
 * @param sessionDocument
 * @param logContext
 */
async function checkInterviewFlowShouldForceGrade(
  sessionDocument: SessionDocument,
  logContext: InterviewBotLoggingContext,
): Promise<boolean> {
  try {
    if (ABTestingService.shouldUseMatchingInterview(sessionDocument.experiment_group, sessionDocument.skillId)) {
      log.info(`Interview is determined as a new matching interview format`, logContext);
      return false;
    }

    const context = await SessionContext.fetch(sessionDocument.id, true, true);
    if (context?.skill?.mode !== 'interview') {
      log.info(`Provided session is not an interview flow`, logContext);
      return false;
    }

    const unGradedQuestions = context?.questions?.filter((it) => it.correctnessGrading == null) ?? [];
    if (unGradedQuestions.length === 0) {
      log.info(`No ungraded interviews found`, logContext);
      return false;
    }

    for (let question of unGradedQuestions) {
      const calibratedQuestion = context.calibratedQuestions.find((it) => it.id === question.questionId);
      if (calibratedQuestion == null) {
        log.info(`Cannot find related calibrated question for ${question.questionId}`, logContext);
        continue;
      }
      const flowService = new InterviewQuestionFlowService();
      // Will mutate question.correctnessGrading if graded
      await flowService.generateAssistantResponse(question, sessionDocument, calibratedQuestion, true);
    }

    // Do the final scoring
    const grading = await ScoreCalculation.gradeSession(
      'Every questions has been graded individually so there is no overall summary',
      {
        session: sessionDocument,
        skill: context.skill,
        questions: context.questions,
        logContext,
      },
      false,
    );

    if (grading.score == null) {
      log.info(`No overall grading score is calculated for session`, logContext);
      return false;
    }

    if ((grading.score ?? 0) >= (sessionDocument.noDelayIfScoreAbove ?? 0)) {
      log.info(
        `Score is gte threshold (${grading.score} >= ${sessionDocument.noDelayIfScoreAbove}) should proceed with grading`,
        logContext,
      );
      return true;
    } else {
      log.info(
        `Score is below threshold, discard grading (${grading.score} < ${sessionDocument.noDelayIfScoreAbove})`,
        logContext,
      );
      return false;
    }
  } catch (e) {
    log.error(`Error while verifying grading for abandoned interview`, logContext, e);
    return false;
  }
}

async function gradeInterviewSkillQuestions(session: SessionDocument): Promise<void> {
  const logContext = log.context({ sessionId: session.id });
  log.info(`Doing a final grading for interview skill questions`, logContext);

  if (ABTestingService.shouldUseMatchingInterview(session.experiment_group, session.skillId)) {
    log.info(`Grading matching interview question`, logContext);
    const matchingInterviewQuestion = (await Question.getAllForSession(session.id))[0];
    const gradedResult = await MatchingInterviewGradingService.grade(session, matchingInterviewQuestion);
    matchingInterviewQuestion.correctnessGrading = {
      score: gradedResult.finalScore,
      summary: JSON.stringify(gradedResult.grading),
      reasoning: gradedResult.reasoning,
    };
    await DynamoDB.putDocument(matchingInterviewQuestion);
  }

  // Get all questions
  const questions = await Question.getAllForSession(session.id);

  // Some interviews may be ended by the user before the end result
  // Such questions will have state = Completed and no grading
  const abandonedQuestion = questions.filter((it) => it.state === 'Completed' && it.correctnessGrading == null);
  if (abandonedQuestion.length > 0) {
    log.info(`Found ${abandonedQuestion.length} abandoned questions`, logContext);

    // Update such questions and set grading to zero
    abandonedQuestion.forEach((it) => {
      it.correctnessGrading = {
        score: 0,
        summary: 'User has ended conversation prematurely',
      };
      it.error = 'ConversationEnded';
    });

    // Update in DDB
    await DynamoDB.putDocuments(abandonedQuestion);
  }

  // Determine if we had any errors (token limit or end of conversation)
  const problematicQuestions = questions.filter((it) => it.error != null);
  if (problematicQuestions.length > 0) {
    log.info(`Detected ${problematicQuestions.length} problematic questions, sending error event`, logContext);
    const errorMessage = problematicQuestions
      .map((it) => `${it.questionId}: ${it.error} (${it.correctnessGrading?.summary ?? 'No additional info'})`)
      .join('; ');
    log.info(errorMessage, logContext);
    // Send a special status event to the XO
    await Session.sendStatusEventSessionError(session, errorMessage);
    // Update session
    await Session.setStateToGraded(
      session.id,
      {
        summary: ProblematicQuestionsDetected,
        score: 0,
      },
      session.secretKey == null,
    );
  } else {
    // Send "completed" session event right now, as the grading event will be delayed
    await Session.sendStatusEvent(session);

    const skill = await Skill.getById(session.skillId);
    if (skill == null) {
      throw new Error(`Cannot find skill for the session ${session.id}: ${session.skillId}`);
    }

    // Do the final scoring
    await ScoreCalculation.gradeSession('Every questions has been graded individually so there is no overall summary', {
      session,
      skill,
      questions,
      logContext,
    });
  }
}

/**
 * We grade each question separately here
 */
async function triggerIndividualQuestionGrading(session: SessionDocument, skill: SkillDocument) {
  // Set current graded questions count to 0
  await Session.setGradedQuestionsCounter(session.id, 0);

  // Get all questions
  const questions = await Question.getAllForSession(session.id);

  // Send a separate grading message for each of the question
  await Sqs.bulkSendGptMessages(
    questions.map((it) => ({
      type: 'grade-individual-answer',
      sessionId: session.id,
      questionId: it.id,
    })),
  );
}

/**
 * All questions have been graded individually
 */
async function handleGradingDoneForIndividualQuestions(session: SessionDocument) {
  const logContext = { sessionId: session.id };
  log.info(`Grading session after individual questions graded`, logContext);

  // Get all questions
  const questions = await Question.getAllForSession(session.id);
  const skill = await Skill.getById(session.skillId);

  if (skill == null) {
    log.error(`Cannot fetch skill for session, stopping grading`, logContext);
    return;
  }

  // Do the final scoring
  await ScoreCalculation.gradeSession('Every questions has been graded individually so there is no overall summary', {
    session,
    skill,
    questions,
    logContext,
  });
}
