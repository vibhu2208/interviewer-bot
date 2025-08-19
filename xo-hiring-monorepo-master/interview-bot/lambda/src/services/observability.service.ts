import { CloudWatchMetrics } from '../integrations/cloudwatch-metrics';
import { SessionState } from '../model/session';

const SessionMetrics = {
  SessionsCreated: 'SessionsCreated',
  SessionsStarted: 'SessionsStarted',
  SessionsCompleted: 'SessionsCompleted',
  SessionsGraded: 'SessionsGraded',
  SessionDuration: 'SessionDuration',
} as const;
type SessionMetrics = typeof SessionMetrics[keyof typeof SessionMetrics];

const PerformanceMetrics = {
  ConversationTurns: 'ConversationTurns',
  LLMResponseTime: 'LLMResponseTime',
  LLMTotalTokens: 'LLMTotalTokens',
} as const;
type PerformanceMetrics = typeof PerformanceMetrics[keyof typeof PerformanceMetrics];

const GradingMetrics = {
  GradingTime: 'GradingTime',
  FinalScores: 'FinalScores',
  GradingTokens: 'GradingTokens',
} as const;
type GradingMetrics = typeof GradingMetrics[keyof typeof GradingMetrics];

const ErrorMetrics = {
  LLMErrors: 'LLMErrors',
  GradingErrors: 'GradingErrors',
} as const;
type ErrorMetrics = typeof ErrorMetrics[keyof typeof ErrorMetrics];

export interface SessionDimensions {
  experimentGroup: string;
  skillId: string;
}

export class ObservabilityService {
  // Session Lifecycle Tracking
  static async trackSessionCreated(experimentGroup: string, skillId: string): Promise<void> {
    await CloudWatchMetrics.incrementCounter(SessionMetrics.SessionsCreated, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  static async trackSessionStarted(experimentGroup: string, skillId: string): Promise<void> {
    await CloudWatchMetrics.incrementCounter(SessionMetrics.SessionsStarted, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  static async trackSessionCompleted(experimentGroup: string, skillId: string): Promise<void> {
    await CloudWatchMetrics.incrementCounter(SessionMetrics.SessionsCompleted, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  static async trackSessionGraded(experimentGroup: string, skillId: string): Promise<void> {
    await CloudWatchMetrics.incrementCounter(SessionMetrics.SessionsGraded, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  static async trackSessionDuration(experimentGroup: string, skillId: string, durationMs: number): Promise<void> {
    await CloudWatchMetrics.putMetric(SessionMetrics.SessionDuration, durationMs, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  // Performance & Quality Tracking
  static async trackConversationTurn(
    experimentGroup: string,
    skillId: string,
    conversationTurns: number,
  ): Promise<void> {
    await CloudWatchMetrics.putMetric(PerformanceMetrics.ConversationTurns, conversationTurns, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  /**
   * Track LLM performance metrics (response time + token usage) together
   */
  static async trackLLMPerformance(
    experimentGroup: string,
    llmModel: string,
    responseTimeMs: number,
    totalTokens: number,
  ): Promise<void> {
    const dimensions = {
      ExperimentGroup: experimentGroup,
      LLMModel: llmModel,
    };

    await CloudWatchMetrics.putMetrics([
      { name: PerformanceMetrics.LLMResponseTime, value: responseTimeMs, dimensions },
      { name: PerformanceMetrics.LLMTotalTokens, value: totalTokens, dimensions },
    ]);
  }

  // Grading & Scoring Tracking
  static async trackFinalScore(experimentGroup: string, skillId: string, score: number): Promise<void> {
    await CloudWatchMetrics.putMetric(GradingMetrics.FinalScores, score, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  /**
   * Track grading performance metrics (grading time + token usage) together
   * Only applicable for experimental groups with separate grading LLM
   */
  static async trackGradingPerformance(
    experimentGroup: string,
    skillId: string,
    gradingTimeMs: number,
    totalTokens: number,
  ): Promise<void> {
    const dimensions = {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    };

    await CloudWatchMetrics.putMetrics([
      { name: GradingMetrics.GradingTime, value: gradingTimeMs, dimensions },
      { name: GradingMetrics.GradingTokens, value: totalTokens, dimensions },
    ]);
  }

  /**
   * Track requirements evaluation breakdown by status
   */
  static async trackRequirementsYes(experimentGroup: string, skillId: string, count: number): Promise<void> {
    await CloudWatchMetrics.putMetric('RequirementsYes', count, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  static async trackRequirementsNo(experimentGroup: string, skillId: string, count: number): Promise<void> {
    await CloudWatchMetrics.putMetric('RequirementsNo', count, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  static async trackRequirementsWeakPass(experimentGroup: string, skillId: string, count: number): Promise<void> {
    await CloudWatchMetrics.putMetric('RequirementsWeakPass', count, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  static async trackRequirementsUnclear(experimentGroup: string, skillId: string, count: number): Promise<void> {
    await CloudWatchMetrics.putMetric('RequirementsUnclear', count, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  static async trackRequirementsTotal(experimentGroup: string, skillId: string, count: number): Promise<void> {
    await CloudWatchMetrics.putMetric('RequirementsTotal', count, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  /**
   * Track complete requirements breakdown with all status counts
   */
  static async trackRequirementsBreakdown(
    experimentGroup: string,
    skillId: string,
    breakdown: {
      YES: number;
      NO: number;
      WEAK_PASS: number;
      UNCLEAR: number;
    },
  ): Promise<void> {
    const total = breakdown.YES + breakdown.NO + breakdown.WEAK_PASS + breakdown.UNCLEAR;
    await Promise.all([
      this.trackRequirementsYes(experimentGroup, skillId, breakdown.YES),
      this.trackRequirementsNo(experimentGroup, skillId, breakdown.NO),
      this.trackRequirementsWeakPass(experimentGroup, skillId, breakdown.WEAK_PASS),
      this.trackRequirementsUnclear(experimentGroup, skillId, breakdown.UNCLEAR),
      this.trackRequirementsTotal(experimentGroup, skillId, total),
    ]);
  }

  // Error Tracking
  /**
   * Track LLM errors with error type classification
   */
  static async trackLLMError(experimentGroup: string, skillId: string): Promise<void> {
    await CloudWatchMetrics.incrementCounter(ErrorMetrics.LLMErrors, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }

  /**
   * Track grading process errors
   */
  static async trackGradingError(experimentGroup: string, skillId: string): Promise<void> {
    await CloudWatchMetrics.incrementCounter(ErrorMetrics.GradingErrors, {
      ExperimentGroup: experimentGroup,
      SkillId: skillId,
    });
  }
}
