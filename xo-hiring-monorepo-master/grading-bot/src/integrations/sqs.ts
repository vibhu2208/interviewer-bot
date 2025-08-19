import { SendMessageBatchCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { v4 as uuid } from 'uuid';
import { Logger } from '../common/logger';
import { sliceIntoChunks } from '../common/util';
import { Config } from '../config';
import { EventData } from '../tasks/send-status-event';
import { MainTableKeys } from './dynamodb';

const log = Logger.create('sqs');
const client = new SQSClient({ region: Config.getRegion() });

export class Sqs {
  static async bulkSendMessages(messages: SqsMessage[]): Promise<void> {
    log.plain('SQS_BULK_MESSAGES', messages);
    const chunks = sliceIntoChunks(messages, 10);
    for (const chunk of chunks) {
      await client.send(
        new SendMessageBatchCommand({
          QueueUrl: Config.getTasksQueueUrl(),
          Entries: chunk.map((it) => ({
            Id: uuid(),
            MessageBody: JSON.stringify(it),
          })),
        }),
      );
    }
  }

  static async sendMessage(message: SqsMessage, delay?: number): Promise<void> {
    log.plain('SQS_MESSAGE', message);
    await client.send(
      new SendMessageCommand({
        QueueUrl: Config.getTasksQueueUrl(),
        MessageBody: JSON.stringify(message),
        DelaySeconds: delay,
      }),
    );
  }
}

export interface RetryableMessage {
  retries?: number;
  errors?: string[];
}

export type SqsMessage = SqsGradeTaskMessage | SqsSendGradingEventMessage | SqsExecutePromptMessage;

export interface SqsGradeTaskMessage extends RetryableMessage {
  type: 'grade-submission';
  taskId: string;
}

export interface SqsSendGradingEventMessage extends RetryableMessage {
  type: 'send-grading-event';
  taskId: string;
  event: EventData;
}

export interface SqsExecutePromptMessage extends RetryableMessage {
  type: 'execute-prompt';
  taskId: string;
  promptExecutionKey: MainTableKeys;
}

export function incrementRetry<T extends RetryableMessage>(message: T, error: any): T {
  message.retries = (message.retries ?? 0) + 1;
  message.errors = [`${new Date().toISOString()}: ${error}`, ...(message.errors ?? [])];
  return message;
}
