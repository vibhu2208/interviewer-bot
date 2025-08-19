import { SQS } from '@aws-sdk/client-sqs';
import { TaskMessage } from '../models/messages';

export class Sqs {
  static client = new SQS();

  static async sendTask(message: TaskMessage): Promise<void> {
    const queueUrl = process.env.TASKS_QUEUE_URL;

    if (!queueUrl) {
      throw new Error('TASKS_QUEUE_URL environment variable is not set');
    }

    await this.client.sendMessage({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    });
  }
}
