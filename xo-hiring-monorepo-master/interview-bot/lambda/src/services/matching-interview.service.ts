import { InterviewBotLoggingContext, Logger } from '../common/logger';
import { cleanupBedrockConversation, replacePlaceholders } from '../common/util';
import { Config } from '../config';
import { AnswerAttemptResult, AppSync } from '../integrations/appsync';
import { DynamoDB } from '../integrations/dynamodb';
import { LLMService } from '../integrations/llm';
import { Sqs } from '../integrations/sqs';
import { ConversationElement, Question, QuestionDocument } from '../model/question';
import { SessionDocument } from '../model/session';
import { QuestionFlowService } from './question-flow.service';
import { ObservabilityService } from './observability.service';
import { InterviewResponseSchema, InterviewResponseSchemaType, R2Document } from '../schemas/matching-interview.schema';
import { matchingInterviewPrompt } from '../prompts/matching-interview.prompt';
import { R2DocumentFetcher } from './r2-document-fetcher.service';

const log = Logger.create('MatchingInterviewService');
const defaultWelcomeMessage = 'Hi';

export class MatchingInterviewService extends QuestionFlowService {
  constructor() {
    super();
  }

  async processAnswerAttempt(
    answer: string,
    question: QuestionDocument,
    session: SessionDocument,
    currentAttempt: number,
  ): Promise<void> {
    const logContext = log.context({ sessionId: session.id, questionId: question.id });

    log.info('MatchingInterviewService processing answer attempt', logContext);

    const sessionId = session.id;
    const questionId = question.id;

    // Initialize conversation if it doesn't exist
    if (question.conversation == null) {
      if (answer === '') {
        answer = defaultWelcomeMessage;
      }
      question.conversation = [];
    }

    // Add user message to conversation
    if (answer.length > 0) {
      question.conversation.push({
        role: 'user',
        content: answer,
      });
    }

    // Update conversation in database
    await Question.updateConversation(sessionId, questionId, question.conversation);

    // Send SQS message to trigger matching interview LLM processing
    await Sqs.sendGptMessage({
      type: 'matching-interview-user-message',
      questionId: questionId,
      sessionId: sessionId,
    });
  }

  async generateAssistantResponse(
    question: QuestionDocument,
    session: SessionDocument,
    forceGrading: boolean = false,
  ): Promise<void> {
    const logContext = log.context({ sessionId: session.id, questionId: question.id });

    log.info('Generating matching interview assistant response', logContext);

    try {
      const conversation = this.prepareConversation(question);
      const { prompt: systemPrompt, r2Document } = await this.buildSystemPrompt(session);

      const { response, responseTimeMs, usage, reasoning } = await this.callLLM(systemPrompt, conversation, logContext);
      // Track LLM performance metrics
      await this.trackLLMPerformance(
        session.experiment_group,
        Config.getMatchingInterviewLlmModel().model,
        responseTimeMs,
        usage?.totalTokens || 0,
        logContext,
      );

      // Save assistant message to conversation
      conversation.push({
        role: 'assistant',
        content: response.object.message,
        reasoning,
      });
      await this.updateConversation(session.id, question.id, conversation);
      // Track conversation turn for A/B test monitoring
      await this.trackConversationTurn(session, conversation.length, logContext);

      // Send message to frontend
      const appSyncUpdatePayload: AnswerAttemptResult = {
        sessionId: session.id,
        questionId: question.id,
        result: response.object.message,
        state: response.object.readyForGrading ? 'Completed' : null,
      };
      if (response.object.readyForGrading) {
        log.info('Question is completed', logContext);
        question.state = 'Completed';
        await this.saveQuestion(question);
      }
      log.info('Notifying answer attempt', logContext);
      await this.notifyAnswerAttempted(appSyncUpdatePayload);

      return;
    } catch (error) {
      const errorInstance = error instanceof Error ? error : new Error(String(error));
      log.error('LLM assistant response generation failed', errorInstance, logContext);

      // Track LLM error
      if (session.experiment_group) {
        try {
          await ObservabilityService.trackLLMError(session.experiment_group, session.skillId);
        } catch (trackingError) {
          log.warn('Failed to track LLM error metric', trackingError, logContext);
        }
      }

      throw errorInstance;
    }
  }

  /**
   * Track conversation turn
   */
  private async trackConversationTurn(
    session: SessionDocument,
    length: number,
    logContext: InterviewBotLoggingContext,
  ) {
    if (session.experiment_group) {
      try {
        await ObservabilityService.trackConversationTurn(session.experiment_group, session.skillId, length);
      } catch (e) {
        log.warn('Failed to track conversation turn metric', e, logContext);
      }
    }
  }

  /**
   * Prepare conversation for LLM
   */
  private prepareConversation(question: QuestionDocument): ConversationElement[] {
    if (!question.conversation) {
      question.conversation = [];
    } else {
      question.conversation = cleanupBedrockConversation(question.conversation, true);
    }
    return question.conversation;
  }

  /**
   * Build system prompt for LLM
   */
  private async buildSystemPrompt(session: SessionDocument): Promise<{ prompt: string; r2Document: R2Document }> {
    const r2Document = await R2DocumentFetcher.fetch(session);
    const prompt = replacePlaceholders(matchingInterviewPrompt, {
      session,
      r2Document,
      currentTime: new Date().toISOString(),
    });

    if (prompt == null) {
      throw new Error(`System prompt is null`);
    }

    return { prompt, r2Document };
  }

  /**
   * Call LLM with structured output and extended thinking
   */
  private async callLLM(
    systemPrompt: string,
    conversation: ConversationElement[],
    logContext: InterviewBotLoggingContext,
  ): Promise<{
    response: { object: InterviewResponseSchemaType };
    responseTimeMs: number;
    usage?: { totalTokens: number };
    reasoning?: string;
  }> {
    return await LLMService.callWithStructuredOutput({
      systemPrompt,
      conversation,
      schema: InterviewResponseSchema,
      logContext,
    });
  }

  /**
   * Track LLM performance
   */
  private async trackLLMPerformance(
    experimentGroup: string | undefined,
    modelId: string,
    responseTimeMs: number,
    totalTokens: number | undefined,
    logContext: InterviewBotLoggingContext,
  ): Promise<void> {
    if (!experimentGroup || !totalTokens) return;

    try {
      await ObservabilityService.trackLLMPerformance(experimentGroup, modelId, responseTimeMs, totalTokens);
    } catch (e) {
      log.warn('Failed to track LLM performance metrics', e, logContext);
    }
  }

  /**
   * Update conversation in database - can be overridden for testing
   */
  protected async updateConversation(sessionId: string, questionId: string, conversation: any[]): Promise<void> {
    await Question.updateConversation(sessionId, questionId, conversation);
  }

  /**
   * Notify frontend of answer attempt - can be overridden for testing
   */
  protected async notifyAnswerAttempted(answerAttemptResult: AnswerAttemptResult): Promise<void> {
    await AppSync.triggerAnswerAttempted(answerAttemptResult);
  }

  /**
   * Save question to database - can be overridden for testing
   */
  protected async saveQuestion(question: QuestionDocument): Promise<void> {
    await DynamoDB.putDocument(question);
  }
}
