import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { Config } from '../config';
import { RetryableMessage } from './sqs';

const client = new SFNClient({ region: Config.getRegion() });

export class StepFunctions {
  static async sendDelayedQueueMessage(
    name: string,
    queueUrl: string,
    payload: RetryableMessage,
    delaySeconds: number,
  ): Promise<void> {
    // Start SM execution for delayed message
    const command = new StartExecutionCommand({
      stateMachineArn: Config.getDelayedStatusEventSMArn(),
      input: JSON.stringify({
        smInput: {
          queueUrl: queueUrl,
          delayForSeconds: delaySeconds,
          statusEvent: payload,
        },
      }),
      name,
    });
    await client.send(command);
  }
}
