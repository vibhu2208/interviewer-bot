import { CoreMessage } from 'ai';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';
import { z } from 'zod';
import { KontentPipelineDescription } from '../tasks/generate-summary';

export const toolParams = z.object({
  decision: z.enum(['HIRE', 'REJECT']).describe('The decision to make'),
  reasoning: z.string().describe('The reasoning for the decision'),
  gaps_in_requirements: z.string().describe('The gaps in the requirements'),
  recording_url: z.string().describe('The URL of the interview recording'),
});

// Convert the tool parameters to a type
export type ToolParams = z.infer<typeof toolParams>;

export function getConversationKey(id: string) {
  return {
    pk: 'CONVERSATION',
    sk: id,
  };
}

export interface ConversationDocument extends MainTableKeys {
  asrId: string;
  promptId: string;
  messages: CoreMessage[];
  context: {
    pipeline: KontentPipelineDescription;
  };
  isComplete: boolean;
  toolCall: { args: ToolParams } | undefined;
}

export class Conversation {
  static async upsert(data: Omit<ConversationDocument, 'pk' | 'sk'>): Promise<ConversationDocument> {
    const item: ConversationDocument = {
      ...getConversationKey(data.asrId),
      ...data,
    };

    await DynamoDB.putDocument(item);

    return item;
  }

  static async getByAsrId(asrId: string): Promise<ConversationDocument | null> {
    return await DynamoDB.getDocument<ConversationDocument>(getConversationKey(asrId));
  }
}
