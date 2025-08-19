import { MainTableKeys, envVal, getItem, putItem, updateItem } from '../internal-handlers/integrations/dynamodb';
import { TaskStatus, TaskType, truncateTaskIfNeeded } from './task.model';

export const ApplyEmailDefaultPromptId = 'apply-email';

export interface ApplyEmailTaskDocument extends MainTableKeys {
  type: TaskType;
  status: TaskStatus;
  candidateId: string;
  applicationId: string;
  lastUpdateTime?: string;
  promptId?: string;
  subject?: string;
  body?: string;
  prompt?: string;
  error?: string;
}

export function isApplyEmailTask(keys: MainTableKeys | null): keys is ApplyEmailTaskDocument {
  return keys?.pk === `TASK#${TaskType.APPLY_EMAIL}`;
}

function getApplyEmailTaskKey(candidateId: string, applicationId: string): MainTableKeys {
  return {
    pk: `TASK#${TaskType.APPLY_EMAIL}`,
    sk: `${candidateId}#${applicationId}`,
  };
}

export class ApplyEmailTask {
  static create(input: Omit<ApplyEmailTaskDocument, 'pk' | 'sk'>): ApplyEmailTaskDocument {
    return {
      ...getApplyEmailTaskKey(input.candidateId, input.applicationId),
      ...input,
    };
  }

  static async getById(candidateId: string, applicationId: string): Promise<ApplyEmailTaskDocument | null> {
    return getItem<ApplyEmailTaskDocument>(
      envVal('AI_DATA_TABLE_NAME'),
      getApplyEmailTaskKey(candidateId, applicationId),
    );
  }

  static async getByKey(key: MainTableKeys): Promise<ApplyEmailTaskDocument | null> {
    return getItem<ApplyEmailTaskDocument>(envVal('AI_DATA_TABLE_NAME'), key);
  }

  static async save(task: ApplyEmailTaskDocument) {
    const truncatedTask = truncateTaskIfNeeded(task);
    return putItem(envVal('AI_DATA_TABLE_NAME'), truncatedTask);
  }

  static async restart(key: MainTableKeys) {
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
