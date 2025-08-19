import { CalibratedQuestion, CalibratedQuestionDocument } from '../model/calibrated-question';
import { Question, QuestionDocument } from '../model/question';
import { QuestionGenerator, QuestionGeneratorDocument } from '../model/question-generator';
import { Session, SessionDocument } from '../model/session';
import { Skill, SkillDocument } from '../model/skill';
import { Logger } from './logger';

const log = Logger.create('session-context');

export class SessionContext {
  static async fetch(
    sessionId: string,
    withQuestions = false,
    withCalibratedQuestions = false,
  ): Promise<SessionContextData | null> {
    const session = await Session.getById(sessionId);
    if (session == null) {
      log.error(`Fetching context but Session is null`, { sessionId });
      return null;
    }

    const skill = await Skill.getById(session.skillId);
    if (skill == null) {
      log.error(`Fetching context but Skill is null`, { sessionId });
      return null;
    }

    const [questionGenerator, questions, calibratedQuestions] = await Promise.all([
      QuestionGenerator.getById(skill.generatorId),
      withQuestions ? Question.getAllForSession(sessionId) : Promise.resolve([]),
      withCalibratedQuestions ? CalibratedQuestion.getAllForSkill(skill.id) : Promise.resolve([]),
    ]);

    if (questionGenerator == null) {
      log.error(`Fetching context but QuestionGenerator is null`, { sessionId });
      return null;
    }

    return {
      questions,
      session,
      skill,
      questionGenerator,
      calibratedQuestions,
    };
  }
}

/**
 * Add additional fields to the questions
 */
export interface EnrichedQuestionDocument extends QuestionDocument {
  index?: number;
}

export interface SessionContextData {
  session: SessionDocument;
  skill: SkillDocument;
  questionGenerator: QuestionGeneratorDocument;
  questions: EnrichedQuestionDocument[];
  calibratedQuestions: CalibratedQuestionDocument[];
  /**
   * This variable is used in individual answer grading mode
   */
  question?: QuestionDocument;
}
