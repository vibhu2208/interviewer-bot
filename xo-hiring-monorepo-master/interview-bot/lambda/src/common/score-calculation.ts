import { Dimension } from '../model/calibrated-question';
import { Grading, QuestionDocument, DimensionGrading } from '../model/question';
import { Session, SessionDocument } from '../model/session';
import { SkillDocument } from '../model/skill';
import { InterviewBotLoggingContext, Logger } from './logger';

const log = Logger.create('score-calculation');

export class ScoreCalculation {
  /**
   * Calculate a final score of the session. Should be called after the session id complete
   * @param questions
   * @param logContext
   * @return score
   */
  static calculateForQuestions(questions: QuestionDocument[], logContext?: InterviewBotLoggingContext): number {
    // Only calculate score for Published calibrated questions
    const publishedQuestions = questions.filter((it) => it.status !== 'Calibration');
    log.info(`${questions.length} questions, ${publishedQuestions.length} are Published`, logContext);

    // Calculate the average score
    const averageDepth = ScoreCalculation.calculateAverageScore(publishedQuestions.map((it) => it.depthGrading));
    const averageCorrectness = ScoreCalculation.calculateAverageScore(
      publishedQuestions.map((it) => it.correctnessGrading),
    );
    const averageScore = ScoreCalculation.calculateAverageScore([
      { score: averageDepth },
      { score: averageCorrectness },
    ]);

    log.info(
      `averageDepth = ${averageDepth}, averageCorrectness = ${averageCorrectness}, averageScore = ${averageScore}`,
      logContext,
    );

    return averageScore ?? 0;
  }

  /**
   * Return the average score of existing (defined) gradings
   */
  static calculateAverageScore(gradings: (Grading | undefined)[]): number | undefined {
    let total = 0;
    let count = 0;

    gradings.forEach((it) => {
      if (typeof it?.score === 'number') {
        total += it?.score;
        count++;
      }
    });

    return count > 0 ? total / count : undefined;
  }

  static scoreOverrideFromTabSwitch(session: SessionDocument, skill: SkillDocument): Grading | null {
    if (skill.failIfDetectedTabSwitchesMoreThan != null) {
      const tabVisibilityEventsCount =
        session?.sessionEvents?.filter((it) => it.type === 'tabVisibilityLost')?.length ?? 0;
      if (tabVisibilityEventsCount > skill.failIfDetectedTabSwitchesMoreThan) {
        return {
          score: 0,
          summary: `Candidate switched tab ${tabVisibilityEventsCount} times (> ${skill.failIfDetectedTabSwitchesMoreThan})`,
        };
      }
    }
    return null;
  }

  /**
   * Perform the final score calculation based on the graded questions and other grading elements
   */
  static async gradeSession(summary: string, context: SessionGradingContext, updateDdb = true): Promise<Grading> {
    // Calculate the final score based on the questions first
    let grading: Grading = {
      score: ScoreCalculation.calculateForQuestions(context.questions, context.logContext),
      summary,
    };

    // Check if we have score override from tab switch
    const override = ScoreCalculation.scoreOverrideFromTabSwitch(context.session, context.skill);
    if (override != null) {
      grading = override;
    }

    if (updateDdb) {
      await Session.setStateToGraded(context.session.id, grading, context.session.secretKey == null);
    }

    return grading;
  }

  /**
   * Calculate the score from dimensions grading.
   * @param dimensions Array of dimension.
   * @param dimensionsGrading Array of dimensions grading.
   * @returns The calculated score as a percentage.
   */
  static calculateScoreFromDimensions(dimensions: Dimension[], dimensionsGrading: DimensionGrading[]): number {
    const totalAwardedLevels = dimensionsGrading.reduce((sum, dimension) => sum + dimension.level, 0);
    const totalPossibleLevels = dimensions.reduce((sum, dimension) => sum + dimension.levels, 0);

    return Math.round((totalAwardedLevels / totalPossibleLevels) * 100) / 10; // 10 is a max score for the system
  }
}

export interface SessionGradingContext {
  session: SessionDocument;
  skill: SkillDocument;
  questions: QuestionDocument[];
  logContext?: InterviewBotLoggingContext;
}
