import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { InterviewBotConfiguration } from './interview-bot-configuration';

export interface InterviewBotDashboardProps {
  config: StackConfig;
  envConfig: InterviewBotConfiguration;
  pilotSkillId: string;
}

/**
 * CloudWatch Dashboard for AI Matching Interview A/B Testing Monitoring
 * Scoped to specific pilot skill for focused A/B testing analysis
 *
 * Uses clear, comparative visualizations optimized for A/B testing analysis
 */
export class InterviewBotDashboard extends Construct {
  private readonly dashboard: cloudwatch.Dashboard;
  private readonly config: StackConfig;
  private readonly envConfig: InterviewBotConfiguration;
  private readonly pilotSkillId: string;

  // Metric namespace for all Interview Bot metrics
  private static readonly METRIC_NAMESPACE = 'InterviewBot';

  private static readonly ALL_GROUPS = ['group-1', 'group-2', 'group-3', 'group-4'];
  // Experiment group constants for A/B testing
  private static readonly CONTROL_GROUPS = ['group-1', 'group-4']; // Traditional interview
  private static readonly VARIANT_GROUPS = ['group-2', 'group-3']; // AI matching interview

  constructor(scope: Construct, id: string, props: InterviewBotDashboardProps) {
    super(scope, id);

    this.config = props.config;
    this.envConfig = props.envConfig;
    this.pilotSkillId = props.pilotSkillId;

    this.dashboard = new cloudwatch.Dashboard(this, 'ai-matching-monitoring', {
      dashboardName: this.config.generateName('ai-matching-pilot-skill'),
      defaultInterval: Duration.minutes(5),
    });

    this.createDashboardWidgets();
  }

  /**
   * Create all dashboard widgets with A/B testing focused visualizations
   */
  private createDashboardWidgets(): void {
    // A/B Test Overview: Key performance indicators
    this.dashboard.addWidgets(...this.createABTestOverviewWidgets());

    // Session Flow: Funnel comparison
    this.dashboard.addWidgets(...this.createSessionFlowWidgets());

    // Performance Comparison: Control vs Variant
    this.dashboard.addWidgets(...this.createPerformanceComparisonWidgets());

    // Quality & Errors: Success metrics
    this.dashboard.addWidgets(...this.createQualityMetricsWidgets());
  }

  /**
   * A/B Test Overview - Key metrics at a glance
   */
  private createABTestOverviewWidgets(): cloudwatch.IWidget[] {
    return [
      // Control group total sessions
      new cloudwatch.SingleValueWidget({
        title: 'Control Groups (Traditional)',
        width: 6,
        height: 6,
        metrics: [
          ...InterviewBotDashboard.CONTROL_GROUPS.map((group) =>
            this.createMetric('SessionsStarted', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ),
        ],
        sparkline: true,
      }),

      // Variant group total sessions
      new cloudwatch.SingleValueWidget({
        title: 'Variant Groups (AI Matching)',
        width: 6,
        height: 6,
        metrics: [
          ...InterviewBotDashboard.VARIANT_GROUPS.map((group) =>
            this.createMetric('SessionsStarted', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ),
        ],
        sparkline: true,
      }),

      // Control completion rate
      new cloudwatch.SingleValueWidget({
        title: 'Control Completion Rate',
        width: 6,
        height: 6,
        metrics: [
          ...InterviewBotDashboard.CONTROL_GROUPS.map((group) =>
            this.createMetric('SessionsCompleted', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ),
        ],
        sparkline: true,
      }),

      // Variant completion rate
      new cloudwatch.SingleValueWidget({
        title: 'Variant Completion Rate',
        width: 6,
        height: 6,
        metrics: [
          ...InterviewBotDashboard.VARIANT_GROUPS.map((group) =>
            this.createMetric('SessionsCompleted', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ),
        ],
        sparkline: true,
      }),
    ];
  }

  /**
   * Session Flow - Funnel visualization
   */
  private createSessionFlowWidgets(): cloudwatch.IWidget[] {
    return [
      // Session funnel bar chart
      new cloudwatch.GraphWidget({
        title: 'Session Funnel: Control vs Variant',
        width: 24,
        height: 8,
        left: [
          // Control groups
          ...InterviewBotDashboard.CONTROL_GROUPS.flatMap((group) => [
            this.createMetric('SessionsCreated', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
            this.createMetric('SessionsStarted', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
            this.createMetric('SessionsCompleted', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
            this.createMetric('SessionsGraded', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ]),
        ],
        right: [
          // Variant groups
          ...InterviewBotDashboard.VARIANT_GROUPS.flatMap((group) => [
            this.createMetric('SessionsCreated', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
            this.createMetric('SessionsStarted', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
            this.createMetric('SessionsCompleted', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
            this.createMetric('SessionsGraded', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ]),
        ],
        view: cloudwatch.GraphWidgetView.BAR,
        leftYAxis: { label: 'Control Groups' },
        rightYAxis: { label: 'Variant Groups' },
        stacked: false,
      }),
    ];
  }

  /**
   * Performance Comparison - Response times and efficiency
   */
  private createPerformanceComparisonWidgets(): cloudwatch.IWidget[] {
    return [
      // Average session duration - Control
      new cloudwatch.SingleValueWidget({
        title: 'Avg Session Duration - Control',
        width: 6,
        height: 4,
        metrics: [
          ...InterviewBotDashboard.CONTROL_GROUPS.map((group) =>
            this.createMetric('SessionDuration', { ExperimentGroup: group, SkillId: this.pilotSkillId }, 'Average'),
          ),
        ],
        setPeriodToTimeRange: true,
      }),

      // Average session duration - Variant
      new cloudwatch.SingleValueWidget({
        title: 'Avg Session Duration - Variant',
        width: 6,
        height: 4,
        metrics: [
          ...InterviewBotDashboard.VARIANT_GROUPS.map((group) =>
            this.createMetric('SessionDuration', { ExperimentGroup: group, SkillId: this.pilotSkillId }, 'Average'),
          ),
        ],
        setPeriodToTimeRange: true,
      }),

      // Average conversation turns - Control
      new cloudwatch.SingleValueWidget({
        title: 'Avg Conversation Turns - Control',
        width: 6,
        height: 4,
        metrics: [
          ...InterviewBotDashboard.CONTROL_GROUPS.map((group) =>
            this.createMetric('ConversationTurns', { ExperimentGroup: group, SkillId: this.pilotSkillId }, 'Average'),
          ),
        ],
        setPeriodToTimeRange: true,
      }),

      // Average conversation turns - Variant
      new cloudwatch.SingleValueWidget({
        title: 'Avg Conversation Turns - Variant',
        width: 6,
        height: 4,
        metrics: [
          ...InterviewBotDashboard.VARIANT_GROUPS.map((group) =>
            this.createMetric('ConversationTurns', { ExperimentGroup: group, SkillId: this.pilotSkillId }, 'Average'),
          ),
        ],
        setPeriodToTimeRange: true,
      }),

      // LLM Response Time Comparison
      new cloudwatch.GraphWidget({
        title: 'LLM Response Time Comparison',
        width: 12,
        height: 6,
        left: [
          ...InterviewBotDashboard.CONTROL_GROUPS.map((group) =>
            this.createMetric('LLMResponseTime', { ExperimentGroup: group }, 'Average'),
          ),
        ],
        right: [
          ...InterviewBotDashboard.VARIANT_GROUPS.map((group) =>
            this.createMetric('LLMResponseTime', { ExperimentGroup: group }, 'Average'),
          ),
        ],
        view: cloudwatch.GraphWidgetView.BAR,
        leftYAxis: { label: 'Control (ms)' },
        rightYAxis: { label: 'Variant (ms)' },
        stacked: false,
      }),

      // Grading Performance (Variant only)
      new cloudwatch.SingleValueWidget({
        title: 'Avg Grading Time - Variant Only',
        width: 12,
        height: 6,
        metrics: [
          ...InterviewBotDashboard.VARIANT_GROUPS.map((group) =>
            this.createMetric('GradingTime', { ExperimentGroup: group, SkillId: this.pilotSkillId }, 'Average'),
          ),
        ],
        sparkline: true,
      }),
    ];
  }

  /**
   * Quality & Error Metrics - Success indicators
   */
  private createQualityMetricsWidgets(): cloudwatch.IWidget[] {
    return [
      // Final Scores Comparison
      new cloudwatch.GraphWidget({
        title: 'Final Scores: Control vs Variant',
        width: 12,
        height: 6,
        left: [
          ...InterviewBotDashboard.CONTROL_GROUPS.map((group) =>
            this.createMetric('FinalScores', { ExperimentGroup: group, SkillId: this.pilotSkillId }, 'Average'),
          ),
        ],
        right: [
          ...InterviewBotDashboard.VARIANT_GROUPS.map((group) =>
            this.createMetric('FinalScores', { ExperimentGroup: group, SkillId: this.pilotSkillId }, 'Average'),
          ),
        ],
        view: cloudwatch.GraphWidgetView.BAR,
        leftYAxis: { label: 'Control Scores', min: 0, max: 100 },
        rightYAxis: { label: 'Variant Scores', min: 0, max: 100 },
        stacked: false,
      }),

      // Requirements Quality Distribution
      new cloudwatch.GraphWidget({
        title: 'Requirements Quality Distribution',
        width: 12,
        height: 6,
        left: [
          ...InterviewBotDashboard.ALL_GROUPS.map((group) =>
            this.createMetric('RequirementsYes', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ),
        ],
        right: [
          ...InterviewBotDashboard.ALL_GROUPS.map((group) =>
            this.createMetric('RequirementsUnclear', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ),
        ],
        view: cloudwatch.GraphWidgetView.PIE,
        leftYAxis: { label: 'Clear Requirements (YES)' },
        rightYAxis: { label: 'Unclear Requirements' },
        stacked: false,
      }),

      // Error Rates - Control
      new cloudwatch.SingleValueWidget({
        title: 'Error Rate - Control',
        width: 6,
        height: 4,
        metrics: [
          ...InterviewBotDashboard.CONTROL_GROUPS.map((group) =>
            this.createMetric('LLMErrors', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ),
        ],
        setPeriodToTimeRange: true,
      }),

      // Error Rates - Variant
      new cloudwatch.SingleValueWidget({
        title: 'Error Rate - Variant',
        width: 6,
        height: 4,
        metrics: [
          ...InterviewBotDashboard.VARIANT_GROUPS.flatMap((group) => [
            this.createMetric('LLMErrors', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
            this.createMetric('GradingErrors', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ]),
        ],
        setPeriodToTimeRange: true,
      }),

      // Token Usage Comparison
      new cloudwatch.SingleValueWidget({
        title: 'Total Token Usage',
        width: 12,
        height: 4,
        metrics: [
          ...InterviewBotDashboard.ALL_GROUPS.map((group) =>
            this.createMetric('LLMTotalTokens', { ExperimentGroup: group }),
          ),
          ...InterviewBotDashboard.VARIANT_GROUPS.map((group) =>
            this.createMetric('GradingTokens', { ExperimentGroup: group, SkillId: this.pilotSkillId }),
          ),
        ],
        sparkline: true,
      }),
    ];
  }

  /**
   * Helper method to create metrics with consistent dimensions
   */
  private createMetric(metricName: string, dimensions?: Record<string, string>, statistic = 'Sum'): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: InterviewBotDashboard.METRIC_NAMESPACE,
      metricName,
      dimensionsMap: dimensions,
      statistic,
      period: Duration.minutes(5),
    });
  }
}

// Export widget configuration constants
export const DashboardWidgetConfig = {
  OVERVIEW_HEIGHT: 6,
  PERFORMANCE_HEIGHT: 4,
  QUALITY_HEIGHT: 6,
  SYSTEM_HEALTH_HEIGHT: 4,
  FULL_WIDTH: 24,
  HALF_WIDTH: 12,
  QUARTER_WIDTH: 6,
} as const;
