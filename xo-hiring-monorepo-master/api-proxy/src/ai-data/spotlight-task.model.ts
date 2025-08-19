import { MainTableKeys, envVal, getItem, putItem, updateItem } from '../internal-handlers/integrations/dynamodb';
import { TaskStatus, TaskType, truncateTaskIfNeeded } from './task.model';

export const SpotlightDefaultPromptId = 'default';

export interface SpotlightTaskDocument extends MainTableKeys {
  type: TaskType;
  status: TaskStatus;
  candidateId: string;
  pipelineId: string;
  lastUpdateTime?: string;
  promptId?: string;
  summary?: string;
  prompt?: string;
  error?: string;
}

export function isSpotlightTask(keys: MainTableKeys | null): keys is SpotlightTaskDocument {
  return keys?.pk === `TASK#${TaskType.SPOTLIGHT}`;
}

function getSpotlightTaskKey(candidateId: string, pipelineId: string): MainTableKeys {
  return {
    pk: `TASK#${TaskType.SPOTLIGHT}`,
    sk: `${candidateId}#${pipelineId}`,
  };
}

export class SpotlightTask {
  static newSpotlightTask(input: Omit<SpotlightTaskDocument, 'pk' | 'sk'>): SpotlightTaskDocument {
    return {
      ...getSpotlightTaskKey(input.candidateId, input.pipelineId),
      ...input,
    };
  }

  static async getSpotlightById(candidateId: string, pipelineId: string): Promise<SpotlightTaskDocument | null> {
    return getItem<SpotlightTaskDocument>(envVal('AI_DATA_TABLE_NAME'), getSpotlightTaskKey(candidateId, pipelineId));
  }

  static async getSpotlightByKey(key: MainTableKeys): Promise<SpotlightTaskDocument | null> {
    return getItem<SpotlightTaskDocument>(envVal('AI_DATA_TABLE_NAME'), key);
  }

  static async saveTask(task: SpotlightTaskDocument) {
    const truncatedTask = truncateTaskIfNeeded(task);
    return putItem(envVal('AI_DATA_TABLE_NAME'), truncatedTask);
  }

  static async reStartTask(key: MainTableKeys) {
    return updateItem(
      envVal('AI_DATA_TABLE_NAME'),
      { pk: key.pk, sk: key.sk },
      'SET #status = :status',
      '#status <> :status',
      { '#status': 'status' },
      { ':status': TaskStatus.PROGRESS },
    );
  }
}
