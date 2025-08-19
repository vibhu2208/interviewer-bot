import { AmazonBedrockProvider, AmazonBedrockProviderSettings, createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI, OpenAIProvider, OpenAIProviderSettings } from '@ai-sdk/openai';
import { LanguageModelV1 } from 'ai';
import { defaultLogger } from './logger';
import { SecretsManager } from './secrets-manager';

const DefaultProjectName = 'common';
const logger = defaultLogger({ serviceName: 'llm' });

export const DEFAULT_LLM_DEFINITION: LlmDefinition = {
  model: 'anthropic.claude-3-sonnet-20240229-v1:0',
  provider: 'bedrock',
};

// New type alias to ease future provider additions
export type LlmProvider = OpenAIProvider | AmazonBedrockProvider;
export type LlmProviderSettings = OpenAIProviderSettings | AmazonBedrockProviderSettings;
export type LlmProviderEnum = 'openai' | 'bedrock';

/**
 * Definition for the LLM model.
 */
export interface LlmDefinition {
  model: string;
  provider: LlmProviderEnum;
  // Allows additional custom configuration. For example, override secret name.
  config?: LlmProviderSettings;
  // Optionally override the default project name for provider configuration.
  projectName?: string | null;
}

interface OpenAiSecretConfig {
  common: string; // Common key to be used unless project key is not found
  [key: string]: string; // Project-specific keys
}

/**
 * Llm class provides methods to retrieve model providers and models.
 * It caches both providers and models to ensure immutability and fast runtime model access.
 */
export class Llm {
  private static providerCache: Record<string, LlmProvider> = {};
  private static modelCache: Record<string, LanguageModelV1> = {};

  /**
   * Gets the default language model instance (Bedrock Claude).
   * @param projectName Optional project name for provider configuration.
   * @returns A promise that resolves to the default language model instance.
   */
  public static getDefaultModel(projectName?: string): Promise<LanguageModelV1> {
    return this.getModel({
      ...DEFAULT_LLM_DEFINITION,
      projectName,
    });
  }

  /**
   * Gets (and caches) the language model instance.
   * @param definition The LLM definition including model, provider and options.
   * @returns A promise that resolves to the language model instance.
   */
  public static async getModel(definition: LlmDefinition): Promise<LanguageModelV1> {
    const modelKey = `${definition.provider}:${definition.model}:${definition.projectName ?? DefaultProjectName}`;
    if (this.modelCache[modelKey]) {
      return this.modelCache[modelKey];
    }

    const provider = await this.getProvider(definition);
    // Assume the provider returns a function that accepts the model name.
    const model = provider(definition.model);
    // Cache a new instance (immutably)
    this.modelCache = {
      ...this.modelCache,
      [modelKey]: model,
    };

    return model;
  }

  /**
   * Gets (and caches) the provider instance.
   * @param definition The LLM definition.
   * @returns A promise that resolves to the provider.
   */
  public static async getProvider(definition: LlmDefinition): Promise<LlmProvider> {
    const cacheKey = `${definition.provider}:${definition.projectName || DefaultProjectName}`;
    if (this.providerCache[cacheKey]) {
      return this.providerCache[cacheKey];
    }

    let provider: LlmProvider;

    switch (definition.provider) {
      case 'bedrock': {
        // Create a new Bedrock provider. Future customization based on projectName can be added here.
        provider = createAmazonBedrock();
        break;
      }
      case 'openai': {
        // If API key is provided we don't need to fetch secrets, and we can use the provided config
        if (definition.config && 'apiKey' in definition.config && definition.config.apiKey !== null) {
          provider = createOpenAI(definition.config);
          break;
        }

        // Fetch api key from the AWS Secrets
        const secretName = process.env.OPENAI_SECRET_NAME;
        if (secretName == null) {
          throw new Error('OPENAI_SECRET_NAME env variable should be defined or provided in config.');
        }

        // Fetch the secret configuration immutably.
        const config = await SecretsManager.fetchSecretJson<OpenAiSecretConfig>(secretName);
        if (config == null) {
          throw new Error('OpenAI configuration is not available.');
        }

        let apiKey = config.common;
        // Override the api key if project name is provided
        if (definition.projectName != null) {
          if (config[definition.projectName] != null) {
            apiKey = config[definition.projectName];
          } else {
            logger.warn(
              `Project name is provided (${definition.projectName}) but was unable to find OpenAI API Key for it. Using common API Key.`,
            );
          }
        }
        provider = createOpenAI({
          ...definition.config,
          apiKey: apiKey,
        });
        break;
      }
      default:
        throw new Error('Unsupported provider specified.');
    }

    // Cache the provider immutably.
    this.providerCache = {
      ...this.providerCache,
      [cacheKey]: provider,
    };

    return provider;
  }
}
