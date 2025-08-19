import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';

export interface ReadAIParticipant {
  name: string;
  email: string;
}

export interface ReadAIActionItem {
  text: string;
}

export interface ReadAIKeyQuestion {
  text: string;
}

export interface ReadAITopic {
  text: string;
}

export interface ReadAIChapterSummary {
  title: string;
  description: string;
  topics: ReadAITopic[];
}

export interface ReadAITranscriptSpeaker {
  name: string;
}

export interface ReadAITranscriptSpeakerBlock {
  start_time: string;
  end_time: string;
  speaker: ReadAITranscriptSpeaker;
  words: string;
}

export interface ReadAITranscript {
  speakers: ReadAITranscriptSpeaker[];
  speaker_blocks: ReadAITranscriptSpeakerBlock[];
}

export interface ReadAIWebhookPayload {
  session_id: string;
  trigger: string;
  title: string;
  start_time: string;
  end_time: string;
  participants: ReadAIParticipant[];
  owner: ReadAIParticipant;
  summary: string;
  action_items: ReadAIActionItem[];
  key_questions: ReadAIKeyQuestion[];
  topics: ReadAITopic[];
  report_url: string;
  chapter_summaries?: ReadAIChapterSummary[];
  transcript: ReadAITranscript;
}

export function getReadAiTranscriptKey(id: string) {
  return {
    pk: 'TRANSCRIPT#READAI',
    sk: id,
  };
}

export interface ReadAiTranscriptDocument extends MainTableKeys {
  id: string;
  asrId: string;
  payload: ReadAIWebhookPayload;
}

export class ReadAiTranscript {
  static async insertNew(data: Omit<ReadAiTranscriptDocument, 'id' | 'pk' | 'sk'>): Promise<ReadAiTranscriptDocument> {
    return ReadAiTranscript.insertNewWithId({
      ...data,
      id: data.asrId,
    });
  }

  static async insertNewWithId(data: Omit<ReadAiTranscriptDocument, 'pk' | 'sk'>): Promise<ReadAiTranscriptDocument> {
    const item: ReadAiTranscriptDocument = {
      ...getReadAiTranscriptKey(data.id),
      ...data,
    };

    await DynamoDB.putDocument(item);

    return item;
  }

  static async getById(id: string): Promise<ReadAiTranscriptDocument | null> {
    return await DynamoDB.getDocument<ReadAiTranscriptDocument>(getReadAiTranscriptKey(id));
  }
}
