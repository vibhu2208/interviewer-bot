import { LlmDefinition } from '@trilogy-group/xoh-integration';
import Handlebars from 'handlebars';
import { LLMProjectName } from '../config';
import { ConversationElement } from '../model/question';

export function sliceIntoChunks<T>(arr: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    const chunk = arr.slice(i, i + chunkSize);
    result.push(chunk);
  }
  return result;
}

/**
 * Replace the placeholders in the prompt with the values from the data object
 * Placeholder is a string in the format of {key1.key2.key3}
 * The value is retrieved from the data object by traversing the keys from the innermost one to the outermost one
 */
export function replacePlaceholders(prompt: string | null, data: { [key: string]: any } | null): string | null {
  try {
    return Handlebars.compile(prompt)(data);
  } catch (error) {
    return prompt;
  }
}

/**
 * Determine model provider based on the model name (naive implementation)
 * @param model
 */
export function modelNameToDefinition(model: string): LlmDefinition {
  return model?.includes('anthropic') || model?.startsWith('arn:')
    ? { projectName: LLMProjectName, provider: 'bedrock', model }
    : { projectName: LLMProjectName, provider: 'openai', model };
}

/**
 * Apply several Bedrock-specific checks to the conversation to make sure the format is valid
 * @param conversation
 * @param removeLastAssistantMessage - should be true if tools are used
 */
export function cleanupBedrockConversation(
  conversation: ConversationElement[],
  removeLastAssistantMessage: boolean = false,
): ConversationElement[] {
  if (conversation.length === 0) {
    return conversation;
  }

  // Replace empty messages since Bedrock does not allow them
  conversation.forEach((message) => {
    if (message.content.trim().length === 0) {
      message.content = '-';
    }
  });

  // Bedrock requires conversation to start from the user message, add one if we do not have it
  if (conversation[0].role !== 'user') {
    conversation = [
      {
        role: 'user',
        content: 'Hi!',
      },
      ...conversation,
    ];
  }

  if (removeLastAssistantMessage) {
    // When using tools, the `assistant` response cannot be the last one, so we should remove it
    if (conversation[conversation.length - 1].role === 'assistant') {
      conversation = conversation.slice(0, conversation.length - 1);
    }
  }

  return conversation;
}
