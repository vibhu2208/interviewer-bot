import { v4 as uuid } from 'uuid';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';

export interface GradingBatchDocument extends MainTableKeys {
  id: string;
  tasksCount: number;
  tasksCompleted: number;
  data: {
    applicationStepId: string;
    startDate: string;
    endDate: string;
    recipientEmail: string;
    notes: string;
  };
}

export function getGradingBatchKey(id: string): MainTableKeys {
  return {
    pk: `GRADING-BATCH`,
    sk: `${id}`,
  };
}

export function isGradingBatch(keys: MainTableKeys | null): boolean {
  return keys?.pk === 'GRADING-BATCH';
}

export class GradingBatch {
  static newDocument(input: Omit<GradingBatchDocument, 'pk' | 'sk' | 'id'>): GradingBatchDocument {
    const id = uuid();
    return {
      id,
      ...getGradingBatchKey(id),
      ...input,
    };
  }

  static async getById(id: string): Promise<GradingBatchDocument | null> {
    return await DynamoDB.getDocument<GradingBatchDocument>(getGradingBatchKey(id));
  }

  static async incrementTaskCounter(id: string): Promise<GradingBatchDocument> {
    return (
      await DynamoDB.updateDocument({
        Key: getGradingBatchKey(id),
        UpdateExpression: 'ADD tasksCompleted :inc',
        ExpressionAttributeValues: {
          ':inc': 1,
        },
        ReturnValues: 'ALL_NEW',
      })
    ).Attributes as GradingBatchDocument;
  }
}
