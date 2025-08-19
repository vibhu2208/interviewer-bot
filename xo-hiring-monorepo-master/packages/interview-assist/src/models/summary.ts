import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';

export function getSummaryKey(transcriptId: string) {
  return {
    pk: 'SUMMARY',
    sk: `${transcriptId}`,
  };
}

export interface SummaryDocument extends MainTableKeys {
  transcriptId: string;
  promptId: string;
  summary: string;
  reportUrl: string;
}

export class Summary {
  static async insertNew(data: Omit<SummaryDocument, 'pk' | 'sk'>): Promise<SummaryDocument> {
    const item: SummaryDocument = {
      ...getSummaryKey(data.transcriptId),
      ...data,
    };

    await DynamoDB.putDocument(item);

    return item;
  }

  static async getByAsrId(asrId: string): Promise<SummaryDocument | null> {
    return await DynamoDB.getDocument<SummaryDocument>(getSummaryKey(asrId));
  }
}
