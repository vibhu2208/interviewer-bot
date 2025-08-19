import { ObservabilityService } from '../../../src/services/observability.service';
import { CloudWatchMetrics } from '../../../src/integrations/cloudwatch-metrics';
import { SessionState } from '../../../src/model/session';

jest.mock('../../../src/integrations/cloudwatch-metrics');

describe('ObservabilityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Session Lifecycle Tracking', () => {
    const experimentGroup = 'Group2';
    const skillId = 'skill-12345';

    describe('trackSessionCreated', () => {
      it('should increment SessionsCreated counter with correct dimensions', async () => {
        const spy = jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockResolvedValue();

        await ObservabilityService.trackSessionCreated(experimentGroup, skillId);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('SessionsCreated', {
          ExperimentGroup: experimentGroup,
          SkillId: skillId,
        });
      });

      it('should propagate CloudWatch errors', async () => {
        const error = new Error('CloudWatch error');
        jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockRejectedValueOnce(error);

        await expect(ObservabilityService.trackSessionCreated(experimentGroup, skillId)).rejects.toThrow(
          'CloudWatch error',
        );
      });
    });

    describe('trackSessionStarted', () => {
      it('should increment SessionsStarted counter with correct dimensions', async () => {
        const spy = jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockResolvedValue();

        await ObservabilityService.trackSessionStarted(experimentGroup, skillId);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('SessionsStarted', {
          ExperimentGroup: experimentGroup,
          SkillId: skillId,
        });
      });
    });

    describe('trackSessionCompleted', () => {
      it('should increment SessionsCompleted counter with correct dimensions', async () => {
        const spy = jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockResolvedValue();

        await ObservabilityService.trackSessionCompleted(experimentGroup, skillId);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('SessionsCompleted', {
          ExperimentGroup: experimentGroup,
          SkillId: skillId,
        });
      });
    });

    describe('trackSessionGraded', () => {
      it('should increment SessionsGraded counter with correct dimensions', async () => {
        const spy = jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockResolvedValue();

        await ObservabilityService.trackSessionGraded(experimentGroup, skillId);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('SessionsGraded', {
          ExperimentGroup: experimentGroup,
          SkillId: skillId,
        });
      });
    });

    describe('trackSessionDuration', () => {
      it('should put SessionDuration metric with correct dimensions', async () => {
        const durationMs = 1800000; // 30 minutes
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

        await ObservabilityService.trackSessionDuration(experimentGroup, skillId, durationMs);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('SessionDuration', durationMs, {
          ExperimentGroup: experimentGroup,
          SkillId: skillId,
        });
      });

      it('should handle zero duration', async () => {
        const durationMs = 0;
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

        await ObservabilityService.trackSessionDuration(experimentGroup, skillId, durationMs);

        expect(spy).toHaveBeenCalledWith('SessionDuration', 0, {
          ExperimentGroup: experimentGroup,
          SkillId: skillId,
        });
      });
    });
  });

  describe('Performance & Quality Tracking', () => {
    const experimentGroup = 'group-3';
    const skillId = 'skill-67890';

    describe('trackConversationTurn', () => {
      it('should increment ConversationTurns counter with correct dimensions', async () => {
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

        await ObservabilityService.trackConversationTurn(experimentGroup, skillId, 1);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('ConversationTurns', 1, {
          ExperimentGroup: experimentGroup,
          SkillId: skillId,
        });
      });
    });

    describe('trackLLMPerformance', () => {
      it('should track both response time and token usage metrics', async () => {
        const llmModel = 'anthropic.claude-3-5-sonnet-20241022-v2:0';
        const responseTimeMs = 2500;
        const totalTokens = 150;
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetrics').mockResolvedValue();

        await ObservabilityService.trackLLMPerformance(experimentGroup, llmModel, responseTimeMs, totalTokens);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith([
          {
            name: 'LLMResponseTime',
            value: responseTimeMs,
            dimensions: { ExperimentGroup: experimentGroup, LLMModel: llmModel },
          },
          {
            name: 'LLMTotalTokens',
            value: totalTokens,
            dimensions: { ExperimentGroup: experimentGroup, LLMModel: llmModel },
          },
        ]);
      });

      it('should handle zero values', async () => {
        const llmModel = 'gpt-4';
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetrics').mockResolvedValue();

        await ObservabilityService.trackLLMPerformance(experimentGroup, llmModel, 0, 0);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith([
          { name: 'LLMResponseTime', value: 0, dimensions: { ExperimentGroup: experimentGroup, LLMModel: llmModel } },
          { name: 'LLMTotalTokens', value: 0, dimensions: { ExperimentGroup: experimentGroup, LLMModel: llmModel } },
        ]);
      });

      it('should handle large values', async () => {
        const llmModel = 'claude-3';
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetrics').mockResolvedValue();
        const largeValues = { responseTime: 5000, tokens: 8192 };

        await ObservabilityService.trackLLMPerformance(
          experimentGroup,
          llmModel,
          largeValues.responseTime,
          largeValues.tokens,
        );

        expect(spy).toHaveBeenCalledWith([
          {
            name: 'LLMResponseTime',
            value: largeValues.responseTime,
            dimensions: { ExperimentGroup: experimentGroup, LLMModel: llmModel },
          },
          {
            name: 'LLMTotalTokens',
            value: largeValues.tokens,
            dimensions: { ExperimentGroup: experimentGroup, LLMModel: llmModel },
          },
        ]);
      });
    });

    // Grading & Scoring Tracking
    describe('trackFinalScore', () => {
      it('should track final score metric with correct dimensions', async () => {
        const finalScore = 7.5;
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

        await ObservabilityService.trackFinalScore(experimentGroup, skillId, finalScore);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith('FinalScores', finalScore, {
          ExperimentGroup: experimentGroup,
          SkillId: skillId,
        });
      });

      it('should handle zero score', async () => {
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

        await ObservabilityService.trackFinalScore(experimentGroup, skillId, 0);

        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('should handle maximum score', async () => {
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

        await ObservabilityService.trackFinalScore(experimentGroup, skillId, 10);

        expect(spy).toHaveBeenCalledTimes(1);
      });
    });

    describe('trackGradingPerformance', () => {
      it('should track both grading time and token usage metrics', async () => {
        const gradingTimeMs = 3500;
        const totalTokens = 250;
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetrics').mockResolvedValue();

        await ObservabilityService.trackGradingPerformance(experimentGroup, skillId, gradingTimeMs, totalTokens);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith([
          {
            name: 'GradingTime',
            value: gradingTimeMs,
            dimensions: { ExperimentGroup: experimentGroup, SkillId: skillId },
          },
          {
            name: 'GradingTokens',
            value: totalTokens,
            dimensions: { ExperimentGroup: experimentGroup, SkillId: skillId },
          },
        ]);
      });

      it('should handle zero values', async () => {
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetrics').mockResolvedValue();

        await ObservabilityService.trackGradingPerformance(experimentGroup, skillId, 0, 0);

        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('should handle large values', async () => {
        const spy = jest.spyOn(CloudWatchMetrics, 'putMetrics').mockResolvedValue();

        await ObservabilityService.trackGradingPerformance(experimentGroup, skillId, 60000, 5000);

        expect(spy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Grading & Scoring Metrics', () => {
    it('should track grading performance with correct parameters', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetrics').mockResolvedValue();

      await ObservabilityService.trackGradingPerformance('group-2', 'skill-123', 1500, 250);

      expect(spy).toHaveBeenCalledWith([
        { name: 'GradingTime', value: 1500, dimensions: { ExperimentGroup: 'group-2', SkillId: 'skill-123' } },
        { name: 'GradingTokens', value: 250, dimensions: { ExperimentGroup: 'group-2', SkillId: 'skill-123' } },
      ]);
    });

    it('should track final score with correct parameters', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

      await ObservabilityService.trackFinalScore('group-3', 'skill-456', 8.5);

      expect(spy).toHaveBeenCalledWith('FinalScores', 8.5, {
        ExperimentGroup: 'group-3',
        SkillId: 'skill-456',
      });
    });
  });

  describe('Requirements Tracking Metrics', () => {
    it('should track requirements YES count', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

      await ObservabilityService.trackRequirementsYes('group-2', 'skill-123', 3);

      expect(spy).toHaveBeenCalledWith('RequirementsYes', 3, {
        ExperimentGroup: 'group-2',
        SkillId: 'skill-123',
      });
    });

    it('should track requirements NO count', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

      await ObservabilityService.trackRequirementsNo('group-2', 'skill-123', 1);

      expect(spy).toHaveBeenCalledWith('RequirementsNo', 1, {
        ExperimentGroup: 'group-2',
        SkillId: 'skill-123',
      });
    });

    it('should track requirements WEAK_PASS count', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

      await ObservabilityService.trackRequirementsWeakPass('group-2', 'skill-123', 2);

      expect(spy).toHaveBeenCalledWith('RequirementsWeakPass', 2, {
        ExperimentGroup: 'group-2',
        SkillId: 'skill-123',
      });
    });

    it('should track requirements UNCLEAR count', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

      await ObservabilityService.trackRequirementsUnclear('group-2', 'skill-123', 4);

      expect(spy).toHaveBeenCalledWith('RequirementsUnclear', 4, {
        ExperimentGroup: 'group-2',
        SkillId: 'skill-123',
      });
    });

    it('should track requirements total count', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();

      await ObservabilityService.trackRequirementsTotal('group-2', 'skill-123', 10);

      expect(spy).toHaveBeenCalledWith('RequirementsTotal', 10, {
        ExperimentGroup: 'group-2',
        SkillId: 'skill-123',
      });
    });

    it('should track complete requirements breakdown', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();
      const breakdown = {
        YES: 3,
        NO: 1,
        WEAK_PASS: 2,
        UNCLEAR: 4,
      };

      await ObservabilityService.trackRequirementsBreakdown('group-3', 'skill-789', breakdown);

      expect(spy).toHaveBeenCalledWith('RequirementsYes', 3, {
        ExperimentGroup: 'group-3',
        SkillId: 'skill-789',
      });
      expect(spy).toHaveBeenCalledWith('RequirementsNo', 1, {
        ExperimentGroup: 'group-3',
        SkillId: 'skill-789',
      });
      expect(spy).toHaveBeenCalledWith('RequirementsWeakPass', 2, {
        ExperimentGroup: 'group-3',
        SkillId: 'skill-789',
      });
      expect(spy).toHaveBeenCalledWith('RequirementsUnclear', 4, {
        ExperimentGroup: 'group-3',
        SkillId: 'skill-789',
      });
      expect(spy).toHaveBeenCalledWith('RequirementsTotal', 10, {
        ExperimentGroup: 'group-3',
        SkillId: 'skill-789',
      });

      // Verify all calls were made in parallel
      expect(spy).toHaveBeenCalledTimes(5);
    });

    it('should handle zero counts in requirements breakdown', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockResolvedValue();
      const breakdown = {
        YES: 0,
        NO: 0,
        WEAK_PASS: 0,
        UNCLEAR: 2,
      };

      await ObservabilityService.trackRequirementsBreakdown('group-2', 'skill-123', breakdown);

      expect(spy).toHaveBeenCalledWith('RequirementsYes', 0, {
        ExperimentGroup: 'group-2',
        SkillId: 'skill-123',
      });
      expect(spy).toHaveBeenCalledWith('RequirementsUnclear', 2, {
        ExperimentGroup: 'group-2',
        SkillId: 'skill-123',
      });
      expect(spy).toHaveBeenCalledWith('RequirementsTotal', 2, {
        ExperimentGroup: 'group-2',
        SkillId: 'skill-123',
      });
    });

    it('should propagate CloudWatch errors for requirements tracking', async () => {
      const error = new Error('CloudWatch failed');
      const spy = jest.spyOn(CloudWatchMetrics, 'putMetric').mockRejectedValueOnce(error);

      await expect(ObservabilityService.trackRequirementsYes('group-2', 'skill-123', 5)).rejects.toThrow(
        'CloudWatch failed',
      );
    });
  });

  describe('Error Tracking Metrics', () => {
    it('should track LLM errors with correct dimensions', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockResolvedValue();

      await ObservabilityService.trackLLMError('group-2', 'skill-123');

      expect(spy).toHaveBeenCalledWith('LLMErrors', {
        ExperimentGroup: 'group-2',
        SkillId: 'skill-123',
      });
    });

    it('should track grading errors with correct dimensions', async () => {
      const spy = jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockResolvedValue();

      await ObservabilityService.trackGradingError('group-3', 'skill-789');

      expect(spy).toHaveBeenCalledWith('GradingErrors', {
        ExperimentGroup: 'group-3',
        SkillId: 'skill-789',
      });
    });

    it('should propagate CloudWatch errors for LLM error tracking', async () => {
      const error = new Error('CloudWatch failed');
      const spy = jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockRejectedValueOnce(error);

      await expect(ObservabilityService.trackLLMError('group-2', 'skill-123')).rejects.toThrow('CloudWatch failed');
    });

    it('should propagate CloudWatch errors for grading error tracking', async () => {
      const error = new Error('CloudWatch failed');
      const spy = jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockRejectedValueOnce(error);

      await expect(ObservabilityService.trackGradingError('group-2', 'skill-123')).rejects.toThrow('CloudWatch failed');
    });
  });

  describe('integration scenarios', () => {
    it('should handle multiple sessions concurrently', async () => {
      const sessions = [
        { experimentGroup: 'Group1', skillId: 'skill-1' },
        { experimentGroup: 'Group2', skillId: 'skill-2' },
        { experimentGroup: 'Group3', skillId: 'skill-3' },
      ];
      const spy = jest.spyOn(CloudWatchMetrics, 'incrementCounter').mockResolvedValue();

      const promises = sessions.map((session) =>
        ObservabilityService.trackSessionCreated(session.experimentGroup, session.skillId),
      );

      await Promise.all(promises);

      expect(spy).toHaveBeenCalledTimes(3);
    });
  });
});
