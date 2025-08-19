import { DateTime } from 'luxon';
import { Logger } from '../common/logger';
import { QuestionDocument } from '../model/question';
import { Session, SessionDocument } from '../model/session';

const log = Logger.create('xo-integration');

export class Crossover {
  static generateStatusEvent(
    session: SessionDocument,
    questions: QuestionDocument[],
  ): CrossoverAssessmentStatusEvent | null {
    if (!['Completed', 'Graded'].includes(session.state)) {
      log.info(`Attempt to generate Crossover status event for session that is not completed yet`, {
        sessionId: session.id,
      });
      return null;
    }
    const totalScore = formatScore(session.grading?.score);

    const assessmentDetails: CrossoverAssessmentDetails = {
      assessment_id: session.id,
      score: totalScore,
      summary: session.grading?.summary,
      submission_time: formatTime(session?.startTime),
      duration: formatDuration(session?.startTime, session?.endTime),
    };

    if (questions.length > 0 && totalScore != null) {
      // @ts-ignore
      const details: CrossoverAssessmentSectionDetails = {
        score: totalScore,
      };
      for (const question of questions) {
        if (question.correctnessGrading?.score && question.depthGrading?.score) {
          details[question.id] = {
            score: formatScore((question.correctnessGrading.score + question.depthGrading.score) / 2) as string,
            candidate_response: question.answer,
          };
        }
      }
      assessmentDetails.details = {
        main: details,
      };
    }

    const fraudCheck = this.generateFraudCheck(questions);
    if (fraudCheck) {
      assessmentDetails.fraud_check = fraudCheck;
    }

    const gradingReportUrl = Session.gradingReportUrl(session);
    return {
      status: session.state === 'Completed' ? 'submitted' : 'completed',
      results_url: session.state === 'Graded' ? gradingReportUrl : undefined,
      assessment: assessmentDetails,
    };
  }

  private static generateFraudCheck(questions: QuestionDocument[]): CrossoverAssessmentFraudCheckElement | null {
    const similarSubmissions: Array<{
      submissionId: string;
      questionId: string;
      levenshtein: number;
      jaccard: number;
    }> = [];

    for (const question of questions) {
      if (question.similarityScores?.length) {
        const questionSimilarSubmissions = question.similarityScores
          .filter((score) => score.levenshtein > 0.9 || score.jaccard > 0.6)
          .map((score) => ({
            submissionId: score.id,
            questionId: question.id,
            levenshtein: score.levenshtein,
            jaccard: score.jaccard,
          }));

        similarSubmissions.push(...questionSimilarSubmissions);
      }
    }

    if (similarSubmissions.length === 0) {
      return null;
    }

    const hasDefiniteFraud = similarSubmissions.some((sub) => sub.levenshtein > 0.99);

    const description = `Similar Submissions:\n${similarSubmissions
      .map(
        (sub) =>
          `Submission ID: ${sub.submissionId}\n- Question ID: ${
            sub.questionId
          }\n- Levenshtein Similarity: ${sub.levenshtein.toFixed(2)}\n- Jaccard Similarity: ${sub.jaccard.toFixed(2)}`,
      )
      .join('\n\n')}`;

    // LAMBDA-83811: Always send confidence = 0 till we eliminate false-positives
    return {
      confidence: 0,
      description,
    };
  }
}

/**
 * @param score real number in 1-10 range
 * @return string of an integer number in 1-100 range (percent)
 */
function formatScore(score: number | undefined): string | undefined {
  if (score != null) {
    return `${Math.round(score * 10)}`;
  }
}

/**
 * @param startTime ISO time
 * @param endTime ISO time
 * @return format HH:MM:SS
 */
function formatDuration(startTime: string | undefined, endTime: string | undefined): string | undefined {
  if (startTime && endTime) {
    return DateTime.fromISO(endTime).diff(DateTime.fromISO(startTime)).toFormat('hh:mm:ss');
  }
}

/**
 * @param time ISO time
 * @return formatted time
 */
export function formatTime(time: string | undefined): string | undefined {
  if (time) {
    return DateTime.fromISO(time, { zone: 'utc' }).toFormat(`yyyy-MM-dd'T'HH:mm:ss`);
  }
}

export interface CrossoverAssessmentStatusEvent {
  status: 'submitted' | 'completed' | 'rejected' | 'declined' | 'expired';
  results_url?: string;
  assessment: CrossoverAssessmentDetails;
}

export interface CrossoverAssessmentDetails {
  assessment_id: string;
  score?: string;
  grade?: 'failed' | 'passed' | 'excelled';
  summary?: string;
  submission_time?: string;
  duration?: string;
  fraud_check?: CrossoverAssessmentFraudCheckElement;
  details?: {
    main: CrossoverAssessmentSectionDetails;
  };
}

export interface CrossoverAssessmentFraudCheckElement {
  confidence: number; // 0..1 decimal (%)
  description: string;
}

interface CrossoverAssessmentSectionDetails {
  // @ts-ignore
  score: string;
  [questionId: string]: CrossoverAssessmentQuestionDetails;
}

interface CrossoverAssessmentQuestionDetails {
  score: string;
  candidate_response?: string;
}
