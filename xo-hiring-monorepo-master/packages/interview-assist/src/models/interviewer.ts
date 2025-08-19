import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';

export function getInterviewerKey(id: string) {
  return {
    pk: 'INTERVIEWER',
    sk: id,
  };
}

export interface InterviewerDocument extends MainTableKeys {
  interviewerId: string;
  isOnboarded: boolean;
}

export class Interviewer {
  static async upsert(data: Omit<InterviewerDocument, 'pk' | 'sk'>): Promise<InterviewerDocument> {
    const item: InterviewerDocument = {
      ...getInterviewerKey(data.interviewerId),
      ...data,
    };

    await DynamoDB.putDocument(item);

    return item;
  }

  static async getByIds(ids: string[]): Promise<InterviewerDocument[]> {
    const items = await DynamoDB.getDocuments<InterviewerDocument>(ids.map(getInterviewerKey));
    return items;
  }
}
