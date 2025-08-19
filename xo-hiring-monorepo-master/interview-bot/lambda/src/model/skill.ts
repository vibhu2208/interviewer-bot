import { v4 as uuid } from 'uuid';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';

export type SkillMode = 'free-response' | 'prompt-engineering' | 'interview';

export interface SkillDocument extends MainTableKeys {
  id: string;
  name: string;
  domain: string;
  jobTitle: string;
  responsibilities: string;
  description: string;
  exampleQuestions: string[];
  generatorId: string;
  easyWork: string;
  typicalWork: string;
  difficultWork: string;
  questionsPerSession: number;
  instructions?: string;
  mode?: SkillMode;
  /**
   * LAMBDA-71039: On grading, if candidate switched tabs more than the threshold, set the score to zero
   */
  failIfDetectedTabSwitchesMoreThan?: number;
  /**
   * LAMBDA-71667: Skill configuration to detect tab switches during the assessment
   */
  detectTabSwitches?: boolean;
  /**
   * LAMBDA-71667: Skill configuration to prevent copy-paste during the assessment
   */
  preventCopyPaste?: boolean;
}

export function getSkillKey(skillId: string): MainTableKeys {
  return {
    pk: `SKILL#${skillId}`,
    sk: `SKILL`,
  };
}

export class Skill {
  static newDocument(input: Omit<SkillDocument, 'pk' | 'sk' | 'id'>): SkillDocument {
    const id = uuid();
    return {
      id,
      mode: 'free-response',
      ...getSkillKey(id),
      ...input,
    };
  }

  static async getById(skillId: string): Promise<SkillDocument | null> {
    return await DynamoDB.getDocument<SkillDocument>(getSkillKey(skillId));
  }
}
