import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';

const log = defaultLogger();

export async function reTriggerInterviewBotGrading(asrIds: string[]): Promise<void> {
  const sqsClient = new SQSClient();

  // Get session for every ASR and send an SQS regrading message
  const sf = await Salesforce.getAdminClient();
  for (const affectedAsr of asrIds) {
    const asrs = await sf.querySOQL<{ External_Submission_Id__c: string }>(
      `SELECT External_Submission_Id__c FROM Application_Step_Result__c WHERE Id = '${affectedAsr}'`,
    );
    if (asrs.length === 0) {
      log.warn(`Cannot find ASR for id ${affectedAsr}`);
      continue;
    }
    const asr = asrs[0];
    if (asr.External_Submission_Id__c == null) {
      log.warn(`Submission is not defined for ${affectedAsr}`);
      continue;
    }

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: 'https://sqs.us-east-1.amazonaws.com/104042860393/xo-hiring-interview-bot-production-gpt-commands',
        MessageBody: JSON.stringify({
          type: 'regrade-session',
          sessionId: asrs[0].External_Submission_Id__c,
        }),
      }),
    );
    log.info(`Sent regrading message for ${asrs[0].External_Submission_Id__c} (${affectedAsr})`);
  }
}
