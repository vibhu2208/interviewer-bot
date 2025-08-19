import { LLMService, LLMConfig } from '../../../src/integrations/llm';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import { Config } from '../../../src/config';

// Mock AWS SDK
jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('../../../src/config');

// Test data factories
const createTestSchema = () =>
  z
    .object({
      message: z.string().describe('Your conversational response to the candidate'),
      readyForGrading: z.boolean().describe('Whether sufficient information has been gathered'),
    })
    .describe('Test response schema');

const createMockBedrockResponse = (overrides: any = {}) => ({
  output: {
    message: {
      content: [
        {
          toolUse: {
            toolUseId: 'tooluse_1',
            name: 'StructuredOutput',
            input: {
              message: 'Hello, how can I help you?',
              readyForGrading: false,
            },
          },
        },
      ],
    },
  },
  usage: {
    totalTokens: 150,
  },
  ...overrides,
});

const createMockConversation = () => [
  { role: 'user' as const, content: 'Hello' },
  { role: 'assistant' as const, content: 'Hi there!' },
];

const createBasicRequest = (overrides: any = {}) => ({
  systemPrompt: 'You are a helpful assistant.',
  conversation: createMockConversation(),
  schema: createTestSchema(),
  ...overrides,
});

// Test helper functions
const createMockResponseWithReasoning = (reasoning: string, response: any) => ({
  ...createMockBedrockResponse(),
  output: {
    message: {
      content: [
        {
          reasoningContent: {
            reasoningText: {
              text: reasoning,
            },
          },
        },
        {
          toolUse: {
            toolUseId: 'tooluse_1',
            name: 'StructuredOutput',
            input: response,
          },
        },
      ],
    },
  },
});

const createInvalidJsonResponse = (invalidInput: any = 'invalid json') => ({
  ...createMockBedrockResponse(),
  output: {
    message: {
      content: [
        {
          toolUse: {
            toolUseId: 'tooluse_1',
            name: 'StructuredOutput',
            input: invalidInput,
          },
        },
      ],
    },
  },
});

const createEmptyResponse = () => ({
  ...createMockBedrockResponse(),
  output: {
    message: {
      content: [],
    },
  },
});

// Test assertion helpers
const expectValidResult = (result: any, expectedMessage: string = 'Hello, how can I help you?') => {
  expect(result.response.object.message).toBe(expectedMessage);
  expect(result.responseTimeMs).toBeGreaterThanOrEqual(0);
  expect(typeof result.responseTimeMs).toBe('number');
};

const expectCommandInput = (commandInput: any, expectedConfig: Partial<LLMConfig> = {}) => {
  expect(commandInput.system[0].text).toContain('You are a helpful assistant.');
  expect(commandInput.toolConfig).toBeDefined();
  expect(commandInput.toolConfig.tools).toHaveLength(1);
  expect(commandInput.toolConfig.tools[0].toolSpec.name).toBe('StructuredOutput');

  if (expectedConfig.modelId) {
    expect(commandInput.modelId).toBe(expectedConfig.modelId);
  }
  if (expectedConfig.temperature !== undefined) {
    expect(commandInput.inferenceConfig.temperature).toBe(expectedConfig.temperature);
  }
  if (expectedConfig.maxTokens !== undefined) {
    expect(commandInput.inferenceConfig.maxTokens).toBe(expectedConfig.maxTokens);
  }
  if (expectedConfig.reasoningBudget !== undefined) {
    if (expectedConfig.reasoningBudget === 0) {
      expect(commandInput.additionalModelRequestFields).toBeUndefined();
    } else {
      expect(commandInput.additionalModelRequestFields.thinking.budget_tokens).toBe(expectedConfig.reasoningBudget);
    }
  }
};

// Test setup helpers
class TestSetup {
  mockBedrockClient = {
    send: jest.fn(),
  };

  mockConfig = {
    getRegion: jest.fn(() => 'us-east-1'),
    getMatchingInterviewLlmModel: jest.fn(() => ({
      model: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    })),
  };

  mockConverseCommandInputs: any[] = [];

  setup() {
    jest.clearAllMocks();
    this.mockConverseCommandInputs.length = 0;

    // Setup mocks
    (BedrockRuntimeClient as jest.Mock).mockImplementation(() => this.mockBedrockClient);
    (Config.getRegion as jest.Mock).mockImplementation(this.mockConfig.getRegion);
    (Config.getMatchingInterviewLlmModel as jest.Mock).mockImplementation(this.mockConfig.getMatchingInterviewLlmModel);

    // Mock ConverseCommand to capture inputs
    (ConverseCommand as unknown as jest.Mock).mockImplementation((input: any) => {
      this.mockConverseCommandInputs.push(input);
      return { input };
    });

    // Reset static state
    (LLMService as any).bedrockClient = null;
    (LLMService as any).defaultConfig = null;

    this.mockBedrockClient.send.mockResolvedValue(createMockBedrockResponse());
  }

  setupTimers() {
    jest.useFakeTimers();
  }

  teardownTimers() {
    jest.useRealTimers();
  }
}

describe('LLMService', () => {
  const testSetup = new TestSetup();

  beforeEach(() => {
    testSetup.setup();
  });

  describe('callWithStructuredOutput', () => {
    it('should successfully call LLM with structured output', async () => {
      const request = createBasicRequest();
      const result = await LLMService.callWithStructuredOutput(request);

      expectValidResult(result);
      expect((result.response.object as { readyForGrading: boolean }).readyForGrading).toBe(false);
      expect(result.reasoning).toBeUndefined();
      expect(result.usage).toEqual({ totalTokens: 150 });
      expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(1);
    });

    it('should include reasoning when provided in response', async () => {
      const reasoning = 'I need to think about this carefully...';
      const response = { message: 'After thinking, here is my response', readyForGrading: false };

      testSetup.mockBedrockClient.send.mockResolvedValue(createMockResponseWithReasoning(reasoning, response));

      const request = createBasicRequest();
      const result = await LLMService.callWithStructuredOutput(request);

      expect(result.reasoning).toBe(reasoning);
      expect((result.response.object as { message: string }).message).toBe('After thinking, here is my response');
    });

    describe('configuration', () => {
      const configTests = [
        {
          name: 'should use custom config when provided',
          config: { temperature: 0.5, maxTokens: 2000, reasoningBudget: 1000, modelId: 'custom-model-id' },
        },
        {
          name: 'should disable reasoning when reasoningBudget is 0',
          config: { reasoningBudget: 0 },
        },
      ];

      configTests.forEach(({ name, config }) => {
        it(name, async () => {
          const request = createBasicRequest({ config });
          await LLMService.callWithStructuredOutput(request);
          expectCommandInput(testSetup.mockConverseCommandInputs[0], config);
        });
      });
    });

    it('should create proper structured prompt with JSON schema', async () => {
      const request = createBasicRequest();
      await LLMService.callWithStructuredOutput(request);

      const commandInput = testSetup.mockConverseCommandInputs[0];
      expectCommandInput(commandInput);
      expect(commandInput.toolConfig.tools[0].toolSpec.description).toBe(
        'This tool must be used for every response. It acts as the only valid reply format.',
      );
      expect(commandInput.toolConfig.tools[0].toolSpec.inputSchema.json).toBeDefined();
      expect(commandInput.toolConfig.tools[0].toolSpec.inputSchema.json.type).toBe('object');
    });

    describe('error handling', () => {
      const errorTests = [
        {
          name: 'should handle JSON parsing errors gracefully',
          mockResponse: createInvalidJsonResponse('This is not valid JSON object'),
          expectedError: /LLM response is not valid JSON/,
          expectedCalls: 2,
        },
        {
          name: 'should handle schema validation errors',
          mockResponse: createInvalidJsonResponse({ invalidField: 'value' }),
          expectedError: /LLM response is not valid JSON/,
          expectedCalls: 2,
        },
        {
          name: 'should handle empty response content',
          mockResponse: createEmptyResponse(),
          expectedError: 'No content in LLM response',
          expectedCalls: 2,
        },
      ];

      errorTests.forEach(({ name, mockResponse, expectedError, expectedCalls }) => {
        it(name, async () => {
          testSetup.mockBedrockClient.send.mockResolvedValue(mockResponse);
          const request = createBasicRequest({ config: { maxRetries: 0 } });

          await expect(LLMService.callWithStructuredOutput(request)).rejects.toThrow(expectedError);
          expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(expectedCalls);
        });
      });

      it('should handle Bedrock client errors', async () => {
        testSetup.mockBedrockClient.send.mockRejectedValue(new Error('Bedrock service error'));
        const request = createBasicRequest({ config: { maxRetries: 0 } });

        await expect(LLMService.callWithStructuredOutput(request)).rejects.toThrow('Bedrock service error');
        expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(2);
      });
    });

    it('should properly parse structured tool input', async () => {
      const customResponse = {
        message: 'Properly structured response',
        readyForGrading: true,
      };

      testSetup.mockBedrockClient.send.mockResolvedValue(
        createMockBedrockResponse({
          output: {
            message: {
              content: [
                {
                  toolUse: {
                    toolUseId: 'tooluse_1',
                    name: 'StructuredOutput',
                    input: customResponse,
                  },
                },
              ],
            },
          },
        }),
      );

      const request = createBasicRequest();
      const result = await LLMService.callWithStructuredOutput(request);

      expect(result.response.object).toEqual(customResponse);
    });
  });

  describe('client management', () => {
    it('should reuse the same Bedrock client instance', async () => {
      const request = createBasicRequest();

      await LLMService.callWithStructuredOutput(request);
      await LLMService.callWithStructuredOutput(request);

      expect(BedrockRuntimeClient).toHaveBeenCalledTimes(1);
    });

    it('should use region from Config', () => {
      (LLMService as any).bedrockClient = null;

      const request = createBasicRequest();
      LLMService.callWithStructuredOutput(request);

      expect(Config.getRegion).toHaveBeenCalled();
      expect(BedrockRuntimeClient).toHaveBeenCalledWith({ region: 'us-east-1' });
    });
  });

  describe('conversation formatting', () => {
    const conversationTests = [
      {
        name: 'should properly format conversation for Bedrock',
        conversation: [
          { role: 'user' as const, content: 'What is TypeScript?' },
          { role: 'assistant' as const, content: 'TypeScript is a superset of JavaScript...' },
          { role: 'user' as const, content: 'Can you give me an example?' },
        ],
        expectedLength: 3,
        expectedFirst: { role: 'user', content: 'What is TypeScript?' },
      },
      {
        name: 'should handle empty conversation',
        conversation: [],
        expectedLength: 0,
        expectedFirst: null,
      },
    ];

    conversationTests.forEach(({ name, conversation, expectedLength, expectedFirst }) => {
      it(name, async () => {
        const request = createBasicRequest({ conversation });
        await LLMService.callWithStructuredOutput(request);

        const commandInput = testSetup.mockConverseCommandInputs[0];
        expect(commandInput.messages).toHaveLength(expectedLength);
        expect(commandInput.system[0].text).toContain('You are a helpful assistant.');

        if (expectedFirst) {
          expect(commandInput.messages[0].role).toBe(expectedFirst.role);
          expect(commandInput.messages[0].content[0].text).toBe(expectedFirst.content);
        }
      });
    });
  });

  describe('usage tracking', () => {
    const usageTests = [
      {
        name: 'should track token usage when available',
        mockResponse: createMockBedrockResponse(),
        expectedUsage: { totalTokens: 150 },
      },
      {
        name: 'should handle missing usage information',
        mockResponse: createMockBedrockResponse({ usage: undefined }),
        expectedUsage: undefined,
      },
    ];

    usageTests.forEach(({ name, mockResponse, expectedUsage }) => {
      it(name, async () => {
        testSetup.mockBedrockClient.send.mockResolvedValue(mockResponse);
        const request = createBasicRequest();
        const result = await LLMService.callWithStructuredOutput(request);

        expect(result.usage).toEqual(expectedUsage);
      });
    });
  });

  describe('retry mechanism', () => {
    beforeEach(() => {
      testSetup.setup();
      testSetup.setupTimers();
    });

    afterEach(() => {
      testSetup.teardownTimers();
    });

    const retryTests = [
      {
        name: 'should succeed on first attempt without retries',
        mockSequence: [createMockBedrockResponse()],
        expectedCalls: 1,
        advanceTime: 0,
      },
      {
        name: 'should retry on JSON parsing errors and eventually succeed',
        mockSequence: [createInvalidJsonResponse(), createMockBedrockResponse()],
        expectedCalls: 2,
        advanceTime: 1000,
      },
      {
        name: 'should retry on empty response errors',
        mockSequence: [createEmptyResponse(), createMockBedrockResponse()],
        expectedCalls: 2,
        advanceTime: 1000,
      },
    ];

    retryTests.forEach(({ name, mockSequence, expectedCalls, advanceTime }) => {
      it(name, async () => {
        // Setup mock sequence
        let mockChain = testSetup.mockBedrockClient.send;
        mockSequence.forEach((mock, index) => {
          if (index === mockSequence.length - 1) {
            mockChain = mockChain.mockResolvedValueOnce(mock);
          } else if (mock instanceof Error) {
            mockChain = mockChain.mockRejectedValueOnce(mock);
          } else {
            mockChain = mockChain.mockResolvedValueOnce(mock);
          }
        });

        const request = createBasicRequest();
        const callPromise = LLMService.callWithStructuredOutput(request);

        if (advanceTime > 0) {
          await jest.advanceTimersByTimeAsync(advanceTime);
        }

        const result = await callPromise;
        expectValidResult(result);
        expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(expectedCalls);
      });
    });

    const nonRetryableErrors = [
      'Unauthorized access denied',
      'Quota exceeded for this request',
      'Schema validation failed for input',
    ];

    nonRetryableErrors.forEach((errorMessage) => {
      it(`should not retry on ${errorMessage.toLowerCase()}`, async () => {
        const error = new Error(errorMessage);
        testSetup.mockBedrockClient.send.mockRejectedValue(error);

        const request = createBasicRequest();
        await expect(LLMService.callWithStructuredOutput(request)).rejects.toThrow(errorMessage);
        expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(2);
      });
    });

    it('should implement exponential backoff for retries', async () => {
      const networkError = new Error('Connection timeout');
      testSetup.mockBedrockClient.send
        .mockRejectedValueOnce(networkError)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(createMockBedrockResponse());

      const request = createBasicRequest();
      const callPromise = LLMService.callWithStructuredOutput(request);

      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(2000);

      const result = await callPromise;
      expectValidResult(result);
      expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(3);
    });

    const retryConfigTests = [
      {
        name: 'should respect custom retryDelay configuration',
        config: { retryDelay: 500 },
        advanceTime: 500,
      },
    ];

    retryConfigTests.forEach(({ name, config, advanceTime }) => {
      it(name, async () => {
        const networkError = new Error('Connection timeout');
        testSetup.mockBedrockClient.send
          .mockRejectedValueOnce(networkError)
          .mockResolvedValueOnce(createMockBedrockResponse());

        const request = createBasicRequest({ config });
        const callPromise = LLMService.callWithStructuredOutput(request);

        if (advanceTime > 0) {
          await jest.advanceTimersByTimeAsync(advanceTime);
        }

        const result = await callPromise;
        expectValidResult(result);
        expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('fallback mechanism', () => {
    beforeEach(() => {
      testSetup.setup();
      testSetup.setupTimers();
    });

    afterEach(() => {
      testSetup.teardownTimers();
    });

    const fallbackTests = [
      {
        name: 'should fallback to non-thinking mode when thinking mode fails consistently',
        failingResponse: createInvalidJsonResponse(),
        fallbackMessage: 'Fallback response without thinking',
      },
      {
        name: 'should fallback on empty response errors',
        failingResponse: createEmptyResponse(),
        fallbackMessage: 'Fallback after empty response',
      },
      {
        name: 'should fallback on network errors that exhaust retries',
        failingResponse: new Error('Connection timeout'),
        fallbackMessage: 'Fallback after network errors',
      },
    ];

    fallbackTests.forEach(({ name, failingResponse, fallbackMessage }) => {
      it(name, async () => {
        const fallbackResponse = createMockBedrockResponse({
          output: {
            message: {
              content: [
                {
                  toolUse: {
                    toolUseId: 'tooluse_1',
                    name: 'StructuredOutput',
                    input: {
                      message: fallbackMessage,
                      readyForGrading: false,
                    },
                  },
                },
              ],
            },
          },
        });

        // Setup failing calls followed by successful fallback
        if (failingResponse instanceof Error) {
          testSetup.mockBedrockClient.send
            .mockRejectedValueOnce(failingResponse)
            .mockRejectedValueOnce(failingResponse)
            .mockRejectedValueOnce(failingResponse)
            .mockResolvedValueOnce(fallbackResponse);
        } else {
          testSetup.mockBedrockClient.send
            .mockResolvedValueOnce(failingResponse)
            .mockResolvedValueOnce(failingResponse)
            .mockResolvedValueOnce(failingResponse)
            .mockResolvedValueOnce(fallbackResponse);
        }

        const request = createBasicRequest({
          config: { reasoningBudget: 1000, maxRetries: 2 },
        });

        const callPromise = LLMService.callWithStructuredOutput(request);
        await jest.advanceTimersByTimeAsync(5000);

        const result = await callPromise;
        expectValidResult(result, fallbackMessage);
        expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(4);

        // Verify the fallback call has reasoningBudget disabled
        const fallbackCall = testSetup.mockConverseCommandInputs[3];
        expect(fallbackCall.additionalModelRequestFields).toBeUndefined();
      });
    });

    it('should not use fallback when thinking mode succeeds', async () => {
      const request = createBasicRequest({
        config: { reasoningBudget: 1000, maxRetries: 2 },
      });

      const result = await LLMService.callWithStructuredOutput(request);

      expectValidResult(result);
      expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(1);

      const call = testSetup.mockConverseCommandInputs[0];
      expect(call.additionalModelRequestFields.thinking.budget_tokens).toBe(1000);
    });

    it('should preserve original config except reasoningBudget in fallback', async () => {
      const fallbackResponse = createMockBedrockResponse({
        output: {
          message: {
            content: [
              {
                toolUse: {
                  toolUseId: 'tooluse_1',
                  name: 'StructuredOutput',
                  input: {
                    message: 'Fallback response',
                    readyForGrading: false,
                  },
                },
              },
            ],
          },
        },
      });

      testSetup.mockBedrockClient.send
        .mockResolvedValueOnce(createInvalidJsonResponse())
        .mockResolvedValueOnce(fallbackResponse);

      const request = createBasicRequest({
        config: {
          reasoningBudget: 1000,
          temperature: 0.7,
          maxTokens: 1500,
          modelId: 'custom-model',
          maxRetries: 0,
        },
      });

      const result = await LLMService.callWithStructuredOutput(request);

      expectValidResult(result, 'Fallback response');
      expect(testSetup.mockBedrockClient.send).toHaveBeenCalledTimes(2);

      const fallbackCall = testSetup.mockConverseCommandInputs[1];
      expect(fallbackCall.modelId).toBe('custom-model');
      expect(fallbackCall.inferenceConfig.temperature).toBe(0.7);
      expect(fallbackCall.inferenceConfig.maxTokens).toBe(1500);
      expect(fallbackCall.additionalModelRequestFields).toBeUndefined();
    });
  });
});
