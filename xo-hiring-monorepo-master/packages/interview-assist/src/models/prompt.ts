import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';
import { LlmDefinition } from '../integrations/llm';

export function getPromptKey(id: string) {
  return {
    pk: 'PROMPT',
    sk: id,
  };
}

export interface PromptDocument extends MainTableKeys, LlmDefinition {
  id: string;
  system?: string;
  user?: string;
}

export class Prompt {
  static async insertNew(data: Omit<PromptDocument, 'pk' | 'sk'>): Promise<PromptDocument> {
    const item = {
      ...getPromptKey(data.id),
      ...data,
    };

    await DynamoDB.putDocument(item);

    return item;
  }

  static async getById(id: string): Promise<PromptDocument | null> {
    return await DynamoDB.getDocument<PromptDocument>(getPromptKey(id));
  }
}
