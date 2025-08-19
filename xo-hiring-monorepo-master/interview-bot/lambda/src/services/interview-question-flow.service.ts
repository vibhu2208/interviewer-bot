import { Llm } from '@trilogy-group/xoh-integration';
import { CoreTool, generateText, tool, ToolSet } from 'ai';
import { z } from 'zod';
import { Logger } from '../common/logger';
import { ScoreCalculation } from '../common/score-calculation';
import { cleanupBedrockConversation, replacePlaceholders } from '../common/util';
import { LLMProjectName } from '../config';
import { AnswerAttemptResult, AppSync } from '../integrations/appsync';
import { DynamoDB } from '../integrations/dynamodb';
import { Sqs } from '../integrations/sqs';
import { CalibratedQuestionDocument } from '../model/calibrated-question';
import { Question, QuestionDocument } from '../model/question';
import { SessionDocument } from '../model/session';
import { QuestionFlowService } from './question-flow.service';
import { ObservabilityService } from './observability.service';

const log = Logger.create('InterviewQuestionFlowService');
const defaultWelcomeMessage = 'Hi';

const DimensionGradingSchema = z.object({
  name: z.string().describe('The skill dimension name.'),
  level: z.number().describe('The level for this dimension as a number.'),
  summary: z.string().describe('A summary of the candidate expertise/experience in this dimension.'),
});

const InterviewGradedSchema = z.object({
  profile_fit_summary: z.string().describe('A brief summary of why the profile fit rating was given'),
  profile_fit_rating: z
    .number()
    .min(0)
    .max(10)
    .describe(
      'rate the candidate fit on a scale of 0 to 10: 10 exceeds expectations for all requirements, 8 all requirements clearly met or exceeded, 5 most requirements met, 3 some requirements met, 1 no requirement met, 0 no relevant experience at all',
    ),
});

const InterviewGradedWithDimensionsSchema = z.object({
  dimensions: z.array(DimensionGradingSchema).describe('Grading for each dimension of the answer'),
});

const ToolName = 'grade';

export class InterviewQuestionFlowService extends QuestionFlowService {
  async processAnswerAttempt(
    answer: string,
    question: QuestionDocument,
    session: SessionDocument,
    currentAttempt: number,
  ): Promise<void> {
    const logContext = log.context({ sessionId: session.id, questionId: question.id });

    const sessionId = session.id;
    const questionId = question.id;

    if (question.conversation == null) {
      if (answer == '') {
        answer = defaultWelcomeMessage;
      }
      question.conversation = [];
    }
    if (answer.length > 0) {
      question.conversation.push({
        role: 'user',
        content: answer,
      });
    }

    log.info(`Interview - User:`, logContext, {
      content: answer,
    });

    await Question.updateConversation(sessionId, questionId, question.conversation);

    await Sqs.sendGptMessage({
      type: 'interview-user-message',
      questionId: questionId,
      sessionId: sessionId,
    });
  }

  async generateAssistantResponse(
    question: QuestionDocument,
    session: SessionDocument,
    calibratedQuestion: CalibratedQuestionDocument,
    forceGrading: boolean = false,
  ): Promise<void> {
    const logContext = log.context({ sessionId: session.id, questionId: question.id });

    if (calibratedQuestion.interviewPrompt == null) {
      throw new Error(`InterviewPrompt is not defined for CalibratedQuestion ${calibratedQuestion.sk}`);
    }
    if (question.conversation == null) {
      question.conversation = [];
    }

    const model = await Llm.getDefaultModel(LLMProjectName);
    let systemPrompt = replacePlaceholders(calibratedQuestion.interviewPrompt, {
      session,
      currentTime: new Date().toISOString(),
    });

    if (systemPrompt == null) {
      throw new Error(`System prompt could not be generated`);
    }

    const tools: ToolSet = {};
    let dimensionGrading = false;
    if ((question.dimensions?.length ?? 0) > 0) {
      tools[ToolName] = tool({
        description: 'Grade the interview across multiple dimensions when you have enough information',
        parameters: InterviewGradedWithDimensionsSchema,
        execute: async (args: any) => args,
      }) as CoreTool<any, any>;
      dimensionGrading = true;
    } else {
      tools[ToolName] = tool({
        description: 'Grade the interview with rating when you have enough information',
        parameters: InterviewGradedSchema,
        execute: async (args: any) => args,
      }) as CoreTool<any, any>;
    }

    question.conversation = cleanupBedrockConversation(question.conversation, true);

    systemPrompt += `\n\nIMPORTANT: If you are ready to grade the candidate, ALWAYS invoke the '${ToolName}' tool instead of returning the JSON! Never output JSON grading as a text!`;

    const startTime = Date.now();
    const response = await generateText({
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        ...question.conversation,
      ],
      temperature: 0,
      toolChoice: forceGrading ? 'required' : 'auto',
      tools,
      model,
    });
    const responseTimeMs = Date.now() - startTime;

    // Track LLM performance metrics for A/B test monitoring
    if (session.experiment_group) {
      try {
        await ObservabilityService.trackLLMPerformance(
          session.experiment_group,
          model.modelId,
          responseTimeMs,
          response.usage.totalTokens,
        );
      } catch (e) {
        log.warn('Failed to track LLM performance metrics', e, logContext);
      }
    }

    if (!response) {
      throw new Error(`LLM responded with null output`);
    }

    log.info(`Interview - Assistant:`, logContext, { response });

    let appSyncUpdatePayload: AnswerAttemptResult;

    if (response.toolCalls?.length > 0) {
      const toolCall = response.toolCalls[0];
      const toolOutput = toolCall.args;

      if (response.text) {
        question.promptResult = response.text;
      }

      if (dimensionGrading) {
        const parsedDimensions = InterviewGradedWithDimensionsSchema.parse(toolOutput).dimensions;
        question.dimensionsGrading = parsedDimensions.map((d) => ({
          name: d.name ?? '',
          level: d.level ?? 0,
          summary: d.summary ?? '',
        }));

        const score = ScoreCalculation.calculateScoreFromDimensions(question.dimensions!, question.dimensionsGrading);

        log.info(`Calculated score from dimensions: ${score}`, logContext, {
          dimensionsGrading: question.dimensionsGrading,
          score,
        });

        question.correctnessGrading = {
          score,
          summary: `Each dimension has been graded individually so there is no overall summary`,
        };
      } else {
        const { profile_fit_rating, profile_fit_summary } = InterviewGradedSchema.parse(toolOutput);
        question.correctnessGrading = {
          score: profile_fit_rating,
          summary: profile_fit_summary,
        };
      }

      question.state = 'Completed';
      await DynamoDB.putDocument(question);

      // Track conversation turn for A/B test monitoring
      if (session.experiment_group) {
        try {
          await ObservabilityService.trackConversationTurn(
            session.experiment_group,
            session.skillId,
            question.conversation.length,
          );
        } catch (e) {
          log.warn('Failed to track conversation turn metric', e, logContext);
        }
      }

      appSyncUpdatePayload = {
        sessionId: session.id,
        questionId: question.id,
        state: 'Completed',
        result: '',
      };
    } else if (response.text) {
      question.conversation.push({
        role: 'assistant',
        content: response.text,
      });

      await Question.updateConversation(session.id, question.id, question.conversation);

      appSyncUpdatePayload = {
        sessionId: session.id,
        questionId: question.id,
        result: response.text,
      };
    } else {
      throw new Error(`LLM responded with no text or tool calls`);
    }

    await AppSync.triggerAnswerAttempted(appSyncUpdatePayload);
  }
}
