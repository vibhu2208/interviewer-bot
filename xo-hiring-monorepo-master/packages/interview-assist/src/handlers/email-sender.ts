import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';
import { Context, DynamoDBStreamEvent } from 'aws-lambda';
import Handlebars from 'handlebars';
import { marked } from 'marked';
import { DynamoDB } from '../integrations/dynamodb';
import { Email } from '../integrations/ses';
import { SummaryDocument } from '../models/summary';
import { emailTemplate } from './email-sender.summary.email';

const log = defaultLogger({ serviceName: 'email-sender' });

Salesforce.silent();

export async function handler(event: DynamoDBStreamEvent, context: Context): Promise<void> {
  log.resetKeys();
  const recordsToProcess = event.Records.filter((record) => record.eventName === 'INSERT').filter(
    (record) => record.dynamodb?.NewImage?.pk?.S === 'SUMMARY',
  );

  if (recordsToProcess.length === 0) {
    log.info(`No summary records to process`);
    return;
  }

  log.info(`Processing ${recordsToProcess.length} summary records`);

  const transporter = Email.getTransporter();

  for (const record of recordsToProcess) {
    if (!record.dynamodb?.NewImage) {
      log.error(`No NewImage found in record`);
      continue;
    }

    try {
      const summaryDocument = DynamoDB.unmarshall(record.dynamodb?.NewImage) as SummaryDocument;
      const asrId = summaryDocument.sk.split('#')[0];
      log.appendKeys({ asrId });
      const asr = await getAsr(asrId);

      const template = Handlebars.compile(emailTemplate, {
        noEscape: true,
      });

      const summaryHtml = marked(summaryDocument.summary);

      const emailHtml = template({
        hiringManagerName: asr.Grader__r.Name,
        candidateName: asr.ApplicationId__r.Account.Name,
        position: asr.ApplicationId__r.Pipeline__r.Name,
        readAILink: summaryDocument.reportUrl,
        summary: summaryHtml,
        gradeLink: asr.Grade_URL__c,
      });

      log.info(
        `Sending email to grader ${asr.Grader__r.Id} with CC to Pipeline Manager ${asr.ApplicationId__r.Pipeline__r.ManagerId__r.Id}`,
      );

      await transporter.sendMail({
        from: 'Interview Assist <team@crossover.com>',
        replyTo: 'Interview Assist <team@crossover.com>',
        to: asr.Grader__r.Email,
        cc: [asr.ApplicationId__r.Pipeline__r.ManagerId__r.Email],
        subject: `Ready for Grading: ${asr.ApplicationId__r.Account.Name}'s ${asr.ApplicationId__r.Pipeline__r.Name} Interview`,
        html: emailHtml,
      });

      log.info(`Email sent to grader successfully`);
    } catch (error) {
      log.error(`Error sending email`, {
        error: error,
      });
    }
  }
}

interface AsrRecord {
  Id: string;
  ApplicationId__r: {
    Account: {
      Name: string;
    };
    Pipeline__r: {
      Name: string;
      ManagerId__r: {
        Id: string;
        Email: string;
      };
    };
  };
  Grader__r: {
    Id: string;
    Email: string;
    Name: string;
  };
  Grade_URL__c: string;
}

async function getAsr(asrId: string): Promise<AsrRecord> {
  log.info(`Getting ASR for id: ${asrId}`);

  const sf = await Salesforce.getAdminClient();

  const asrs: AsrRecord[] = await sf.querySOQL<AsrRecord>(`
    SELECT 
      Id,
      ApplicationId__r.Account.Name,
      ApplicationId__r.Pipeline__r.Name,
      ApplicationId__r.Pipeline__r.ManagerId__r.Id,
      ApplicationId__r.Pipeline__r.ManagerId__r.Email,
      Grade_URL__c,
      Grader__r.Id,
      Grader__r.Email,
      Grader__r.Name
    FROM Application_Step_Result__c
    WHERE Id = '${asrId}' LIMIT 1`);

  if (asrs.length === 0) {
    throw new Error(`ASR not found for id: ${asrId}`);
  }

  return asrs[0];
}
