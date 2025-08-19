import { v4 as uuid } from 'uuid';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';

export interface QuestionGeneratorDocument extends MainTableKeys {
  id: string;
  questionPrompt: QuestionPrompt;
  gradingPrompt: QuestionPrompt;
  /**
   * Prompt to select the questions from the list of the Catalogued Questions
   */
  selectorPrompt: QuestionPrompt;
  /**
   * Prompt to check candidate answer for the cheating (used for engineering-prompt questions)
   */
  cheatingPrompt?: QuestionPrompt;
}

export interface QuestionPrompt {
  system: string;
  user: string;
}

export function getQuestionGeneratorKey(generatorId: string): MainTableKeys {
  return {
    pk: `GEN#${generatorId}`,
    sk: `GEN`,
  };
}

export class QuestionGenerator {
  static newDocument(input: Omit<QuestionGeneratorDocument, 'pk' | 'sk' | 'id'>): QuestionGeneratorDocument {
    const id = uuid();
    return {
      id,
      ...getQuestionGeneratorKey(id),
      ...input,
    };
  }

  static async getById(generatorId: string): Promise<QuestionGeneratorDocument | null> {
    return await DynamoDB.getDocument<QuestionGeneratorDocument>(getQuestionGeneratorKey(generatorId));
  }
}
