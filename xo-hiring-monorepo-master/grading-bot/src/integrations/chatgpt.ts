import 'openai/shims/node';
import { AxiosError } from 'axios';
import OpenAI from 'openai';
import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  CompletionUsage,
} from 'openai/resources';
import { GradingBotLoggingContext, Logger } from '../common/logger';
import { NonRetryableError } from '../common/non-retryable-error';
import { Config } from '../config';
import { Secrets } from './secrets';

const log = Logger.create('openai-integration');

let apiClient: OpenAI;

export class ChatGpt {
  static async getApiClient(): Promise<OpenAI> {
    if (apiClient != null) {
      return apiClient;
    }

    const config = await Secrets.fetchJsonSecret<OpenAiConfig>(Config.getOpenAiSecretName());

    apiClient = new OpenAI({
      apiKey: config.gradingBot,
      organization: config.orgId,
    });

    return apiClient;
  }

  static async createCompletion(
    messages: ChatCompletionMessageParam[],
    config?: Partial<ChatCompletionCreateParamsNonStreaming>,
    logContext?: GradingBotLoggingContext,
  ): Promise<string | null> {
    return (await ChatGpt.createCompletionReturnMessage(messages, config, logContext))?.content ?? null;
  }

  static async createCompletionReturnMessage(
    messages: ChatCompletionMessageParam[],
    config?: Partial<ChatCompletionCreateParamsNonStreaming>,
    logContext?: GradingBotLoggingContext,
  ): Promise<ChatCompletionMessage | null> {
    try {
      const request: ChatCompletionCreateParamsNonStreaming = {
        model: 'gpt-4',
        messages: messages,
        temperature: 0,
        n: 1,
        ...config,
      };
      log.debug('GPT_REQUEST', JSON.stringify(request, null, 2), logContext);
      const client = await ChatGpt.getApiClient();
      const result = await client.chat.completions.create(request);
      log.debug('GPT_RESPONSE', JSON.stringify(result, null, 2), logContext);
      if (result.choices?.[0]?.finish_reason === 'length') {
        throw new ChatGptPromptTokenLimitExceededError(result.usage);
      }
      return result.choices?.[0]?.message ?? null;
    } catch (e) {
      if (e instanceof AxiosError) {
        throw new ChatGptError(e);
      }
      throw e;
    }
  }
}

export function getToolInvocation(message: ChatCompletionMessage, name: string): ChatCompletionMessageToolCall | null {
  if (message.tool_calls != null && message.tool_calls.length > 0) {
    return message.tool_calls.find((it) => it.function.name === name) ?? null;
  }
  return null;
}

export class ChatGptError extends Error {
  public headers: any;
  public data: any;
  public status: number;

  constructor(axiosError: AxiosError) {
    super(`Cannot perform ChatGPT Request: ${axiosError.response?.status} ${axiosError.response?.statusText}`);
    this.name = 'ChatGptError';
    this.headers = axiosError.response?.headers;
    this.data = axiosError.config?.data;
    this.status = axiosError.status ?? 500;
  }
}

export class ChatGptPromptTokenLimitExceededError extends NonRetryableError {
  constructor(usage?: CompletionUsage) {
    super(
      `Request exceeds token limitation (Prompt: ${usage?.prompt_tokens}, Completion: ${usage?.completion_tokens}, Total: ${usage?.total_tokens})`,
    );
  }
}

interface OpenAiConfig {
  orgId: string;
  gradingBot: string;
}
