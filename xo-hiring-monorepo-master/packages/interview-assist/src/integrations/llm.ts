import { AmazonBedrockProvider, createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI, OpenAIProvider } from '@ai-sdk/openai';
import { LanguageModelV1 } from '@ai-sdk/provider';
import { SecretsManager } from '@trilogy-group/xoh-integration';

const ProjectName = 'interview-assist';

export interface LlmDefinition {
  model: string;
  provider: 'openai' | 'bedrock';
  config?: object;
}

interface OpenAiConfig {
  orgId: string;
  interviewAssist: string;
}

export class Llm {
  static providerCache: Record<string, OpenAIProvider | AmazonBedrockProvider> = {};
  static modelCache: Record<string, LanguageModelV1> = {};

  static async getModel(definition: LlmDefinition): Promise<LanguageModelV1> {
    const modelKey = `${definition.provider}:${definition.model}`;
    if (this.modelCache[modelKey]) {
      return this.modelCache[modelKey];
    }

    const provider = await this.getProvider(definition);
    const model = provider(definition.model);
    this.modelCache[modelKey] = model;

    return model;
  }

  static async getProvider(definition: LlmDefinition): Promise<OpenAIProvider | AmazonBedrockProvider> {
    if (this.providerCache[definition.provider] != null) {
      return this.providerCache[definition.provider];
    }
    switch (definition.provider) {
      case 'bedrock': {
        // Would be provided by the lambda environment
        const provider = createAmazonBedrock();
        this.providerCache[definition.provider] = provider;
        provider('amazon.titan-text-lite-v1');
        return provider;
      }
      case 'openai': {
        if (!process.env.OPENAI_SECRET_NAME) {
          throw new Error(`OPENAI_SECRET_NAME env variable should be defined`);
        }
        const config = await SecretsManager.fetchSecretJson<OpenAiConfig>(process.env.OPENAI_SECRET_NAME);
        if (config == null) {
          throw new Error(`OpenAI configuration is not available`);
        }
        const provider = createOpenAI({
          apiKey: config.interviewAssist,
          organization: config.orgId,
          project: ProjectName,
        });
        this.providerCache[definition.provider] = provider;
        return provider;
      }
    }
  }
}
