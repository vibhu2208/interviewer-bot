import { v4 as uuid } from 'uuid';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';

export type CalibratedQuestionStatus =
  | 'Review'
  | 'Failed Review'
  | 'Calibration'
  | 'Failed Calibration'
  | 'Published'
  | 'Retired';
export type CalibratedQuestionLevel = 'Easy' | 'Typical' | 'Difficult';

export const ValidStatuses: CalibratedQuestionStatus[] = ['Calibration', 'Published'];

export interface CalibratedQuestionDocument extends MainTableKeys {
  id: string;
  status: CalibratedQuestionStatus;
  question: string;
  perfectAnswer: string;
  level: CalibratedQuestionLevel;
  gradingRubric?: string;
  /**
   * Default answer that will be provided to the candidate in the UI (optional)
   */
  defaultAnswer?: string;
  /**
   * Optional prompt override settings on question level
   */
  promptSettings?: {
    /**
     * AI model (i.e. "gpt-4", "gpt-3.5-turbo", etc)
     */
    model?: string;
    /**
     * The max amount of attempt for the answer (in case if there are several attempts)
     */
    maxAttempts?: number;
  };
  /**
   * Maximum amount of characters (including whitespaces and any other characters) that are allowed for the candidate
   */
  answerMaxSize?: number;
  /**
   * The rubric for the cheating prompt detection
   */
  cheatingRubric?: string;
  /**
   * This field used as a system prompt for the Skill type: interview
   * Not used in other skill types
   */
  interviewPrompt?: string;
  /**
   * The patterns for the cheating prompt detection
   */
  cheatingPatterns?: string[];
  /**
   * Optional grading rules for the question
   */
  gradingRules?: GradingRule[];
  dimensions?: Dimension[];
}

export interface Dimension {
  name: string;
  levels: number;
}

export interface GradingRule {
  description: string;
  score: number;
}

export function getCalibratedQuestionKey(skillId: string, questionId: string): MainTableKeys {
  return {
    pk: `SKILL#${skillId}`,
    sk: `QUESTION#${questionId}`,
  };
}

export class CalibratedQuestion {
  static newDocument(
    skillId: string,
    input: Omit<CalibratedQuestionDocument, 'pk' | 'sk' | 'id'>,
  ): CalibratedQuestionDocument {
    const id = uuid();
    return {
      id,
      ...getCalibratedQuestionKey(skillId, id),
      ...input,
    };
  }

  static async getById(skillId: string, questionId: string): Promise<CalibratedQuestionDocument | null> {
    return await DynamoDB.getDocument<CalibratedQuestionDocument>(getCalibratedQuestionKey(skillId, questionId));
  }

  /**
   * Retrieve batch document by ids, order of results is preserved
   * @param keys
   */
  static async batchGet(
    keys: { skillId: string; questionId: string }[],
  ): Promise<(CalibratedQuestionDocument | null)[]> {
    const requestedKeys = keys.map((it) => getCalibratedQuestionKey(it.skillId, it.questionId));
    // Will not return anything for missing document
    const documents = await DynamoDB.getDocuments<CalibratedQuestionDocument>(requestedKeys);
    return requestedKeys.map((it) => documents.find((doc) => doc.pk === it.pk && doc.sk === it.sk) ?? null);
  }

  static async getAllForSkill(skillId: string): Promise<CalibratedQuestionDocument[]> {
    const result = await DynamoDB.query({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: {
        '#pk': 'pk',
        '#sk': 'sk',
      },
      ExpressionAttributeValues: {
        ':pk': getCalibratedQuestionKey(skillId, '').pk,
        ':sk': 'QUESTION#',
      },
    });

    return (result.Items as CalibratedQuestionDocument[]) ?? [];
  }
}
