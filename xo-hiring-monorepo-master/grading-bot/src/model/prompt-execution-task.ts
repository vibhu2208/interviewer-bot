import { QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from 'openai/resources';
import { GradingBotLoggingContext } from '../common/logger';
import { CandidateSubmissionGrading } from '../common/openai-grading-functions';
import { DynamoDB, MainTableKeys } from '../integrations/dynamodb';

export interface PromptExecutionTaskDocument extends MainTableKeys {
  id: string;
  /**
   * DDB key of the parent, for which we will increment counter once task is done
   */
  parentKey: MainTableKeys;
  /**
   * Optional id of the related entity (i.e. Grading Rule that was a basis for this sub-task)
   */
  relatedId?: string;
  /**
   * Complete messages that should be sent to AI
   */
  messages: ChatCompletionMessageParam[];
  /**
   * Optional config override
   */
  config?: Partial<ChatCompletionCreateParamsNonStreaming>;
  /**
   * Prompt execution result (probably should be a generic type later)
   */
  grading?: CandidateSubmissionGrading;

  /**
   * Log context persisted to be re-used during the prompt execution
   */
  logContext?: GradingBotLoggingContext;
  /**
   * Optional errors storage
   */
  errors?: string[];
  /**
   * Audit fields
   */
  createdAt: string;
  modifiedAt?: string;
}

export function getPromptExecutionTaskTaskKey(parentKey: string, id: string): MainTableKeys {
  return {
    pk: parentKey,
    sk: `PROMPT-EXECUTION-TASK#${id}`,
  };
}

type PromptExecutionTaskDocumentInput = Omit<PromptExecutionTaskDocument, 'pk' | 'sk' | 'id' | 'createdAt'> &
  Partial<Pick<PromptExecutionTaskDocument, 'id'>>;

export class PromptExecutionTask {
  static newDocument(input: PromptExecutionTaskDocumentInput): PromptExecutionTaskDocument {
    const id = input.id ?? uuid();
    return {
      id,
      createdAt: new Date().toISOString(),
      ...getPromptExecutionTaskTaskKey(`${input.parentKey.pk}#${input.parentKey.sk}`, id),
      ...input,
    };
  }

  static newDocumentFor(
    input: Omit<PromptExecutionTaskDocumentInput, 'parentKey'>,
    parent: MainTableKeys,
  ): PromptExecutionTaskDocument {
    return PromptExecutionTask.newDocument({
      parentKey: {
        pk: parent.pk,
        sk: parent.sk,
      },
      ...input,
    });
  }

  static newDocumentWithPromptFor(
    systemPrompt: string,
    userPrompt: string,
    parent: MainTableKeys,
    input?: Partial<PromptExecutionTaskDocument>,
  ): PromptExecutionTaskDocument {
    return PromptExecutionTask.newDocumentFor(
      {
        ...input,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      },
      parent,
    );
  }

  static async getAllForParent(parentKey: MainTableKeys): Promise<PromptExecutionTaskDocument[]> {
    let allItems: PromptExecutionTaskDocument[] = [];
    let lastEvaluatedKey = undefined;

    do {
      const response: QueryCommandOutput = await DynamoDB.query({
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: {
          ':pk': `${parentKey.pk}#${parentKey.sk}`,
          ':sk': 'PROMPT-EXECUTION-TASK#',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      allItems = allItems.concat(response.Items as PromptExecutionTaskDocument[]);
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey != null);

    return allItems;
  }

  static async incrementExecutedTaskCounter(target: MainTableKeys): Promise<void> {
    await DynamoDB.updateDocument({
      Key: target,
      UpdateExpression: 'ADD executedSubTasksCount :inc',
      ExpressionAttributeValues: {
        ':inc': 1,
      },
    });
  }
}
