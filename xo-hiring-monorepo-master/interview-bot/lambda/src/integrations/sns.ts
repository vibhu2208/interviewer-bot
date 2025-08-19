import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { Config } from '../config';

const snsClient = new SNSClient({ region: Config.getRegion() });

export class Sns {
  static async publishMessage(subject: string, message: string): Promise<void> {
    const params = {
      Subject: subject,
      Message: message,
      TopicArn: Config.getSnsTopic(),
    };

    try {
      await snsClient.send(new PublishCommand(params));
      console.log(`Message ${params.Subject} sent to the topic ${params.TopicArn}`);
    } catch (err) {
      console.error(err);
    }
  }
}
