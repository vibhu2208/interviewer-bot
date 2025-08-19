import { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { throwIfNull } from '../common/util';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';
import { GradingRule } from './grading-rule';
import { PromptExecutionTask } from './prompt-execution-task';

export type GradingTaskStatus = 'Pending' | 'GradingStarted' | 'Graded' | 'GradingError';
export type GradingMode =
  | 'Unstructured Google Doc'
  | 'Table Sections Google Doc'
  | 'SM Response'
  | 'SM Response Google Drive';
export const DefaultGradingMode: GradingMode = 'Unstructured Google Doc';

export interface GradingTaskDocument extends MainTableKeys {
  id: string;
  status: GradingTaskStatus;
  rules: GradingRule[];
  gradingMode?: GradingMode;
  submissionLink?: string;
  submission?: QuestionAndAnswer[];
  applicationStepResultId: string;
  applicationStepId: string;
  gradingBatchId?: string;
  grading?: GradingResult[];
  gradingError?: string;
  data?: {
    score: string;
    grader: string;
    applicationName: string;
    submissionTime: string;
  };
  callbackUrl?: string;
  forceNoGradingDelay?: boolean;

  /**
   * Track async sub-task execution
   */
  totalSubTasksCount?: number;
  executedSubTasksCount?: number;
}

export interface GradingResult {
  result: string;
  confidence: number;
  reasoning: string;
  feedback: string;
  systemPrompt: string;
  userPrompt: string;
  ruleId?: string;
  ruleName?: string;
}

export interface QuestionAndAnswer {
  question: string;
  answer: string;
}

export function getGradingTaskKey(id: string): MainTableKeys {
  return {
    pk: `GRADING-TASK`,
    sk: `${id}`,
  };
}

export function isGradingTask(keys: MainTableKeys | null): boolean {
  return keys?.pk === 'GRADING-TASK' && !keys?.sk.startsWith('PROMPT-EXECUTION-TASK#');
}

export class GradingTask {
  static newDocument(input: Omit<GradingTaskDocument, 'pk' | 'sk' | 'id'>): GradingTaskDocument {
    const id = uuid();
    return {
      gradingMode: DefaultGradingMode,
      id,
      ...getGradingTaskKey(id),
      ...input,
    };
  }

  static getCompositeKey(input: GradingTaskDocument): string {
    return `${input.pk}#${input.sk}`;
  }

  static async getById(id: string): Promise<GradingTaskDocument | null> {
    return await DynamoDB.getDocument<GradingTaskDocument>(getGradingTaskKey(id));
  }

  static async getByIdOrThrow(id: string): Promise<GradingTaskDocument> {
    return throwIfNull(await GradingTask.getById(id), `Cannot find GradingTask(id=${id})`);
  }

  static async getForBatch(batchId: string): Promise<GradingTaskDocument[]> {
    let allItems: GradingTaskDocument[] = [];
    let lastEvaluatedKey = undefined;

    do {
      const response: QueryCommandOutput = await DynamoDB.query({
        KeyConditionExpression: 'pk = :pk',
        FilterExpression: 'gradingBatchId = :gradingBatchId',
        ExpressionAttributeValues: {
          ':pk': getGradingTaskKey('').pk,
          ':gradingBatchId': batchId,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      allItems = allItems.concat(response.Items as GradingTaskDocument[]);
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey != null);

    return allItems;
  }

  static async fillFromPromptExecutionTasks(task: GradingTaskDocument): Promise<GradingTaskDocument> {
    const promptTasks = await PromptExecutionTask.getAllForParent(task);

    if (promptTasks.length > 0) {
      task.grading = [];
      promptTasks.forEach((subTask) => {
        const gradingRule = task.rules?.find((rule) => rule.id === subTask.relatedId);
        if (gradingRule == null) {
          return;
        }

        if (subTask.grading == null) {
          task.grading?.push({
            result: 'Unknown',
            confidence: 1,
            reasoning: `Encountered error while grading this rule`,
            feedback: `${subTask.errors?.join('\n')}`,
            systemPrompt: '',
            userPrompt: '',
            ruleId: gradingRule.id,
            ruleName: gradingRule.name,
          });
        } else {
          task.grading?.push({
            result: subTask.grading?.result,
            confidence: subTask.grading?.confidence,
            reasoning: subTask.grading?.reasoning,
            feedback: subTask.grading?.feedback,
            systemPrompt: (subTask.messages.find((it) => it.role === 'system')?.content as string) ?? '',
            userPrompt: (subTask.messages.find((it) => it.role === 'user')?.content as string) ?? '',
            ruleId: gradingRule.id,
            ruleName: gradingRule.name,
          });
        }
      });
    }
    return task;
  }
}
