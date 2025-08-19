import { BedrockRuntimeClient, ConverseCommand, ConverseCommandInput } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { InterviewBotLoggingContext, Logger } from '../common/logger';
import { ConversationElement } from '../model/question';
import { Config } from '../config';

const log = Logger.create('LLMService');

export interface LLMConfig {
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningBudget?: number;
  maxRetries?: number;
  retryDelay?: number;
}

export interface LLMResponse<T> {
  response: { object: T };
  reasoning?: string;
  responseTimeMs: number;
  usage?: { totalTokens: number };
}

export interface LLMRequest<T> {
  systemPrompt: string;
  conversation: ConversationElement[];
  schema: z.ZodType<T>;
  config?: LLMConfig;
  logContext?: InterviewBotLoggingContext;
}

/**
 * LLM Service with structured output and extended thinking support
 * This is a ad-hoc replacement to unblock extended thinking.
 * The Vercel version is not yet stable and has so many bugs.
 */
export class LLMService {
  private static bedrockClient: BedrockRuntimeClient;
  private static defaultConfig: LLMConfig | null = null;

  private static initializeDefaultConfig(): LLMConfig {
    if (!this.defaultConfig) {
      this.defaultConfig = {
        modelId: Config.getMatchingInterviewLlmModel().model,
        temperature: 1,
        maxTokens: 4000,
        reasoningBudget: 2000,
        maxRetries: 3,
        retryDelay: 1000,
      };
    }
    return this.defaultConfig;
  }

  private static getClient(): BedrockRuntimeClient {
    if (!this.bedrockClient) {
      this.bedrockClient = new BedrockRuntimeClient({
        region: Config.getRegion(),
      });
    }
    return this.bedrockClient;
  }

  /**
   * Call LLM with structured output and optional extended thinking
   */
  static async callWithStructuredOutput<T>(request: LLMRequest<T>): Promise<LLMResponse<T>> {
    const config = { ...this.initializeDefaultConfig(), ...request.config };

    try {
      // Try with original config (potentially with thinking)
      return await this.executeWithRetries(request, config);
    } catch (error) {
      // Fallback: Try without thinking if original config had thinking enabled
      if (config.reasoningBudget && config.reasoningBudget > 0) {
        log.warn('Retrying without thinking as fallback', request.logContext, {
          originalReasoningBudget: config.reasoningBudget,
          error: error instanceof Error ? error.message : String(error),
        });

        const fallbackConfig = { ...config, reasoningBudget: 0 };
        return await this.executeLLMCall(request, fallbackConfig);
      }

      throw error;
    }
  }

  /**
   * Execute LLM call with retry logic
   */
  private static async executeWithRetries<T>(request: LLMRequest<T>, config: LLMConfig): Promise<LLMResponse<T>> {
    let lastError: Error;

    for (let attempt = 0; attempt <= config.maxRetries!; attempt++) {
      try {
        if (attempt > 0) {
          const delay = config.retryDelay! * Math.pow(2, attempt - 1);
          log.warn('Retrying LLM call', request.logContext, { attempt, delay, maxRetries: config.maxRetries });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        return await this.executeLLMCall(request, config);
      } catch (error) {
        lastError = error as Error;

        if (!this.isRetryableError(error as Error) || attempt === config.maxRetries) {
          log.error('LLM call failed after all retries', request.logContext, {
            attempt,
            maxRetries: config.maxRetries,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }

        log.warn('LLM call failed, will retry', request.logContext, {
          attempt,
          maxRetries: config.maxRetries,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw lastError!;
  }

  /**
   * Determine if an error is retryable
   */
  private static isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // Retry on JSON parsing errors (malformed responses)
    if (message.includes('llm response is not valid json')) {
      return true;
    }

    // Retry on empty responses
    if (message.includes('no content in llm response')) {
      return true;
    }

    // Don't retry on authentication, authorization, or quota errors
    if (
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('access denied') ||
      message.includes('quota exceeded')
    ) {
      return false;
    }

    // Don't retry on schema validation errors (these are likely prompt/config issues)
    if (message.includes('validation') && !message.includes('json')) {
      return false;
    }

    // Default to retrying for unknown errors (conservative approach)
    return true;
  }

  /**
   * Execute the actual LLM call without retry logic
   */
  private static async executeLLMCall<T>(request: LLMRequest<T>, config: LLMConfig): Promise<LLMResponse<T>> {
    const startTime = Date.now();

    // Convert conversation to Bedrock format
    const messages = request.conversation.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: [{ text: msg.content }],
    }));

    const jsonSchema = zodToJsonSchema(request.schema, {
      name: 'ResponseSchema',
      $refStrategy: 'none', // Inline all references
    })?.definitions?.ResponseSchema;
    if (!jsonSchema) {
      throw new Error('Failed to convert schema to JSON Schema');
    }

    // Configure extended thinking if reasoning budget is provided
    const commandInput: ConverseCommandInput = {
      modelId: config.modelId,
      system: [
        {
          text:
            request.systemPrompt +
            '\nIMPORTANT: You must respond only by invoking the "StructuredOutput" tool. Do not return plain text answers. Any response that is not a tool call will be rejected.',
        },
      ],
      messages,
      inferenceConfig: {
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: 'StructuredOutput',
              description: 'This tool must be used for every response. It acts as the only valid reply format.',
              inputSchema: { json: JSON.parse(JSON.stringify(jsonSchema)) },
            },
          },
        ],
      },
    };

    if (config.reasoningBudget) {
      commandInput.additionalModelRequestFields = {
        thinking: {
          type: 'enabled',
          budget_tokens: config.reasoningBudget,
        },
      };
    }

    const command = new ConverseCommand(commandInput);

    try {
      const response = await this.getClient().send(command);
      const responseTimeMs = Date.now() - startTime;

      // Extract the response content
      const content = response.output?.message?.content;
      if (!content || content.length === 0) {
        throw new Error('No content in LLM response');
      }

      // Get the text content and reasoning
      let toolUseInput: string | undefined;
      let reasoningText: string | undefined;

      for (const block of content) {
        if (block.reasoningContent) {
          reasoningText = block.reasoningContent.reasoningText?.text || '';
        }
        if (block.toolUse) {
          toolUseInput = JSON.stringify(block.toolUse.input);
        }
      }

      if (!toolUseInput) {
        log.error('No expected tool use input in LLM response', request.logContext, response);
        throw new Error('No tool use input in LLM response');
      }

      // Parse and validate the structured JSON response
      const parsedResponse = this.parseStructuredResponse(toolUseInput, request.schema, request.logContext);

      return {
        response: { object: parsedResponse },
        reasoning: reasoningText,
        responseTimeMs,
        usage: response.usage ? { totalTokens: response.usage.totalTokens || 0 } : undefined,
      };
    } catch (error) {
      log.error('Error calling Bedrock LLM:', error, request.logContext);
      throw error;
    }
  }

  /**
   * Parse and validate structured response
   */
  private static parseStructuredResponse<T>(
    responseText: string,
    schema: z.ZodType<T>,
    logContext: InterviewBotLoggingContext | undefined,
  ): T {
    try {
      // Clean up the response text in case there's extra content
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : responseText;

      const rawParsed = JSON.parse(jsonString);

      // Validate against the schema
      return schema.parse(rawParsed);
    } catch (parseError) {
      log.error('Failed to parse LLM response as JSON:', { responseText, error: parseError }, logContext);
      throw new Error(`LLM response is not valid JSON: ${parseError}`);
    }
  }
}
