import { Llm, LlmDefinition } from '../src/llm';
import { createOpenAI } from '@ai-sdk/openai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { SecretsManager } from '../src/secrets-manager';

jest.mock('@ai-sdk/openai');
jest.mock('@ai-sdk/amazon-bedrock');
jest.mock('../src/secrets-manager');

describe('Llm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the cache before each test
    (Llm as any).providerCache = {};
    (Llm as any).modelCache = {};
  });

  describe('getProvider', () => {
    it('should create and cache an OpenAI provider', async () => {
      const mockOpenAI = jest.fn();
      (createOpenAI as jest.Mock).mockReturnValue(mockOpenAI);
      (SecretsManager.fetchSecretJson as jest.Mock).mockResolvedValue({
        common: 'test-api-key',
      });

      process.env.OPENAI_SECRET_NAME = 'test-secret';

      const definition: LlmDefinition = {
        model: 'gpt-3.5-turbo',
        provider: 'openai',
      };

      const provider = await Llm.getProvider(definition);

      expect(provider).toBe(mockOpenAI);
      expect(createOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
      });
      expect(SecretsManager.fetchSecretJson).toHaveBeenCalledWith('test-secret');
    });

    it('should create and cache an Amazon Bedrock provider', async () => {
      const mockBedrock = jest.fn();
      (createAmazonBedrock as jest.Mock).mockReturnValue(mockBedrock);

      const definition: LlmDefinition = {
        model: 'anthropic.claude-v2',
        provider: 'bedrock',
      };

      const provider = await Llm.getProvider(definition);

      expect(provider).toBe(mockBedrock);
      expect(createAmazonBedrock).toHaveBeenCalled();
    });

    it('should use project-specific API key when available', async () => {
      const mockOpenAI = jest.fn();
      (createOpenAI as jest.Mock).mockReturnValue(mockOpenAI);
      (SecretsManager.fetchSecretJson as jest.Mock).mockResolvedValue({
        common: 'common-api-key',
        projectA: 'project-a-api-key',
      });

      process.env.OPENAI_SECRET_NAME = 'test-secret';

      const definition: LlmDefinition = {
        model: 'gpt-3.5-turbo',
        provider: 'openai',
        projectName: 'projectA',
      };

      await Llm.getProvider(definition);

      expect(createOpenAI).toHaveBeenCalledWith({
        apiKey: 'project-a-api-key',
      });
    });

    it('should throw an error for unsupported provider', async () => {
      const definition: LlmDefinition = {
        model: 'unsupported-model',
        provider: 'unsupported' as any,
      };

      await expect(Llm.getProvider(definition)).rejects.toThrow('Unsupported provider specified.');
    });
  });

  describe('getModel', () => {
    it('should return a cached model if available', async () => {
      const mockModel = jest.fn();
      const mockProvider = jest.fn(() => mockModel);
      (createOpenAI as jest.Mock).mockReturnValue(mockProvider);

      const definition: LlmDefinition = {
        model: 'gpt-3.5-turbo',
        provider: 'openai',
      };

      const model1 = await Llm.getModel(definition);
      const model2 = await Llm.getModel(definition);

      expect(model1).toBe(mockModel);
      expect(model2).toBe(mockModel);
      expect(mockProvider).toHaveBeenCalledTimes(1);
      expect(mockProvider).toHaveBeenCalledWith('gpt-3.5-turbo');
    });

    it('should create a new model if not cached', async () => {
      const mockModel = jest.fn();
      const mockProvider = jest.fn(() => mockModel);
      (createAmazonBedrock as jest.Mock).mockReturnValue(mockProvider);

      const definition: LlmDefinition = {
        model: 'anthropic.claude-v2',
        provider: 'bedrock',
      };

      const model = await Llm.getModel(definition);

      expect(model).toBe(mockModel);
      expect(mockProvider).toHaveBeenCalledWith('anthropic.claude-v2');
    });
  });
});
