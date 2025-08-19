import { replacePlaceholders } from '../common/util';
import { ConversationElement, QuestionDocument } from '../model/question';
import { SessionDocument } from '../model/session';
import { Logger } from '../common/logger';
import { matchingInterviewGradingPrompt } from '../prompts/matching-interview-grading.prompt';
import {
  MatchingInterviewGradingSchema,
  MatchingInterviewGrading,
  RequirementMetEnum,
} from '../schemas/matching-interview-grading.schema';
import { ObservabilityService } from './observability.service';
import { R2DocumentFetcher } from './r2-document-fetcher.service';
import { LLMService } from '../integrations/llm';

const log = Logger.create('MatchingInterviewGradingService');

export class MatchingInterviewGradingService {
  static async grade(
    session: SessionDocument,
    question: QuestionDocument,
  ): Promise<{ grading: MatchingInterviewGrading; finalScore: number; reasoning?: string }> {
    const logContext = log.context({ sessionId: session.id, questionId: question.id });

    const r2Document = await R2DocumentFetcher.fetch(session);
    const prompt = replacePlaceholders(matchingInterviewGradingPrompt, {
      r2Document,
    });

    if (prompt == null) {
      throw new Error('Prompt is null');
    }

    try {
      const { response, responseTimeMs, usage, reasoning } = await LLMService.callWithStructuredOutput({
        systemPrompt: prompt,
        conversation: [
          {
            role: 'user',
            content: `Grade the following interview conversation:\n\n${MatchingInterviewGradingService.formatTranscript(
              question.conversation,
            )}`,
          },
        ],
        schema: MatchingInterviewGradingSchema,
      });

      const gradingTimeMs = responseTimeMs;
      const finalScore = MatchingInterviewGradingService.calculateScore(response.object);

      log.info('Grading completed', logContext, {
        grading: response.object,
        usage,
        finalScore,
        gradingTimeMs,
        reasoning,
      });

      // Track grading performance and final score metrics
      if (session.experiment_group) {
        try {
          // Calculate requirements breakdown
          const requirements = response.object.gradingRubricResults.requirements;
          const requirementsBreakdown = {
            YES: requirements.filter((r) => r.met === 'YES').length,
            NO: requirements.filter((r) => r.met === 'NO').length,
            WEAK_PASS: requirements.filter((r) => r.met === 'WEAK_PASS').length,
            UNCLEAR: requirements.filter((r) => r.met === 'UNCLEAR').length,
          };

          await Promise.all([
            ObservabilityService.trackGradingPerformance(
              session.experiment_group,
              session.skillId,
              gradingTimeMs,
              usage?.totalTokens || 0,
            ),
            ObservabilityService.trackFinalScore(session.experiment_group, session.skillId, finalScore),
            ObservabilityService.trackRequirementsBreakdown(
              session.experiment_group,
              session.skillId,
              requirementsBreakdown,
            ),
          ]);
        } catch (e) {
          log.warn('Failed to track grading metrics', e, logContext);
        }
      }

      return {
        grading: response.object,
        finalScore,
        reasoning,
      };
    } catch (error) {
      const errorInstance = error instanceof Error ? error : new Error(String(error));

      log.error('Grading failed', errorInstance, logContext);

      // Track grading and LLM errors
      if (session.experiment_group) {
        try {
          await ObservabilityService.trackGradingError(session.experiment_group, session.skillId);
        } catch (trackingError) {
          log.warn('Failed to track error metrics', trackingError, logContext);
        }
      }

      throw errorInstance;
    }
  }

  private static formatTranscript(conversation: ConversationElement[] | undefined): string {
    return (
      conversation
        ?.filter((c) => c?.role && c?.content)
        .map((c) => {
          if (c?.role === 'user') {
            return `Candidate: ${c?.content}\n`;
          } else if (c?.role === 'assistant') {
            return `Interviewer: ${c?.content}\n`;
          }
          throw new Error(`Unknown role: ${c?.role}`);
        })
        .join('\n\n') || 'No transcript available.'
    );
  }

  /**
   * Calculate numerical score based on the grading rubric results
   * All PASS = 10
   * All PASS or UNCLEAR = 8 + (10 - 8) * [# pass]/[# all]
   * Any rejected = 8 * [#unclear or pass] / [#all]
   */
  private static calculateScore(grading: MatchingInterviewGrading): number {
    const passScore = 8;
    const requirements = grading.gradingRubricResults.requirements;
    const total = requirements.length;

    if (total === 0) {
      log.error('No grading rubric results', log.context({ grading }));
      return 0;
    }

    const counts = requirements.reduce(
      (acc, req) => ({
        ...acc,
        [req.met]: acc[req.met] + 1,
      }),
      { YES: 0, UNCLEAR: 0, NO: 0, WEAK_PASS: 0 },
    );

    const numPass = counts.YES + counts.WEAK_PASS;
    const numUnclear = counts.UNCLEAR;
    const numRejected = counts.NO;

    // All requirements met
    if (numPass === total) {
      return 10;
    }

    // All PASS or UNCLEAR (no rejections)
    if (numRejected === 0) {
      return passScore + (10 - passScore) * (numPass / total);
    }

    // Any rejected requirements
    return passScore * ((numPass + numUnclear) / total);
  }
}
