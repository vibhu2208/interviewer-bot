import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';

function getConfigKey() {
  return {
    pk: 'CONFIG',
    sk: 'CONFIG',
  };
}

export interface ConfigDocument extends MainTableKeys {
  defaultPromptId: string;
  gradeConversationPromptId: string;
  sendReminderEmail: boolean;
}

export class Config {
  static async fetch(): Promise<ConfigDocument | null> {
    return await DynamoDB.getDocument<ConfigDocument>(getConfigKey());
  }
}
