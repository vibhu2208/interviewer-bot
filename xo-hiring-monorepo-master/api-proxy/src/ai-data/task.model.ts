export const enum TaskType {
  SPOTLIGHT = 'SPOTLIGHT',
  APPLY_EMAIL = 'APPLY_EMAIL',
}

export const enum TaskStatus {
  PROGRESS = 'PROGRESS',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

/**
 * Truncate prompt if we close to exceeding the 400KB limit (DDB PutObject Limit)
 * @param task
 * @private
 */
export function truncateTaskIfNeeded<T extends { prompt?: string }>(task: T): T {
  const maxSize = 390 * 1024; // 390KB in bytes
  const encoder = new TextEncoder();
  const itemSize = encoder.encode(JSON.stringify(task)).length;

  if (itemSize <= maxSize || !task.prompt) {
    return task; // For now, we will not do anything else
  }

  const oversize = itemSize - maxSize;
  const promptSize = encoder.encode(task.prompt).length;
  const newPromptSize = promptSize - oversize - 100; // Extra 100 bytes as buffer

  return {
    ...task,
    prompt: task.prompt.slice(0, Math.max(0, newPromptSize)),
  };
}
