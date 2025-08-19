import { MainTableKeys, envVal, getItem, putItem } from '../internal-handlers/integrations/dynamodb';

export interface PromptDocument extends MainTableKeys {
  template: string;
  model?: string;
  temperature?: number;
}

export class Prompt {
  static getPromptKey(name: string): MainTableKeys {
    return {
      pk: 'PROMPT',
      sk: name,
    };
  }

  static newPrompt(name: string, template: string, model?: string, temperature?: number): PromptDocument {
    return {
      ...this.getPromptKey(name),
      template,
      ...(model && { model }),
      ...(temperature && { temperature }),
    };
  }

  static async getPromptByName(name: string): Promise<PromptDocument | null> {
    return getItem<PromptDocument>(envVal('AI_DATA_TABLE_NAME'), this.getPromptKey(name));
  }

  static async savePrompt(prompt: PromptDocument) {
    return putItem(envVal('AI_DATA_TABLE_NAME'), prompt);
  }
}
