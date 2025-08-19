import AWS from 'aws-sdk';
import { SendMessageBatchRequest } from 'aws-sdk/clients/sqs';

export class SqsUtils {
  private readonly sqs: AWS.SQS;
  readonly queueUrl: string;

  constructor(queueUrl: string) {
    AWS.config.update({ region: process.env.AWS_REGION });
    this.sqs = new AWS.SQS();
    this.queueUrl = queueUrl;
  }

  async sendMessages(ids: string[]) {
    const entries = ids.map((id) => {
      return {
        Id: id,
        MessageBody: JSON.stringify({ candidateId: id, operation: 'update' }),
        DelaySeconds: 60,
        MessageAttributes: {
          messageSource: {
            DataType: 'String',
            StringValue: 'oos',
          },
        },
      };
    });

    const batchSize = 10;
    const numBatches = Math.ceil(entries.length / batchSize);

    for (let i = 0; i < numBatches; i++) {
      const startIndex = i * batchSize;
      const endIndex = startIndex + batchSize;
      const batchEntries = entries.slice(startIndex, endIndex);

      const request: SendMessageBatchRequest = {
        QueueUrl: this.queueUrl,
        Entries: batchEntries,
      };

      // send SQS messages in a batch
      const response = await this.sqs.sendMessageBatch(request).promise();
      if (response.Failed && response.Failed.length > 0) {
        console.log('Some messages failed to send:');
        response.Failed.forEach((failedEntry) => {
          console.log(
            `Message ID: ${failedEntry.Id}, Error code: ${failedEntry.Code}, Error message: ${failedEntry.Message}`,
          );
        });
      }
    }
  }
}
