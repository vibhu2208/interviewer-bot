import { SESMessage, SNSEvent } from 'aws-lambda';
import { convert } from 'html-to-text';
import { simpleParser } from 'mailparser';
import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  InputLogEvent,
  PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';

const cloudWatchClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });
const logGroupName = process.env.LOG_GROUP_NAME;

export async function handler(event: SNSEvent): Promise<void> {
  console.log('EVENT', JSON.stringify(event, null, 2));

  const logEvents: InputLogEvent[] = [];
  for (const record of event.Records) {
    const emailMessage = JSON.parse(record.Sns.Message) as SESMessageFromSNS;
    const parsedEmail = await simpleParser(emailMessage.content);
    console.log('EMAIL', parsedEmail);

    let body = parsedEmail.text ?? 'EMPTY';
    if (typeof parsedEmail.html === 'string') {
      body = convert(parsedEmail.html, {
        wordwrap: false,
      });
      console.log('TEXT BODY', body);
    }
    const subject = parsedEmail.subject ?? 'EMPTY';
    const logEvent: LogEventPayload = {
      type: 'Uncategorized',
      subject,
      body,
    };

    determineAdditionalInformation(logEvent);

    logEvents.push({
      timestamp: parsedEmail.date?.getTime() ?? Date.now(),
      message: JSON.stringify(logEvent, null, 2),
    });
  }

  console.log(`Parsed ${logEvents.length} log messages`);
  if (logEvents.length > 0) {
    const logStreamName = new Date().toISOString().split('T')[0]; // Today date
    try {
      await cloudWatchClient.send(
        new CreateLogStreamCommand({
          logStreamName,
          logGroupName,
        }),
      );
      console.log(`Created a new log stream ${logStreamName}`);
    } catch (e) {
      // The specified steam already exists, ignore
    }
    await cloudWatchClient.send(
      new PutLogEventsCommand({
        logGroupName,
        logStreamName,
        logEvents,
      }),
    );
    console.log(`Added ${logEvents.length} log events to the ${logGroupName}/${logStreamName}`);
  }
}

function determineAdditionalInformation(logEvent: LogEventPayload) {
  // Top priority are the last (to override the type)
  // Flow Error
  let match = logEvent.subject.match(/Error Occurred During Flow "(\w+)":/);
  if (match != null) {
    logEvent.flowName = match[1];
    logEvent.type = 'FlowException';
  }
  // Apex Error
  match = logEvent.subject.match(/Developer script exception from Dev Factory India : '([^']+)'/);
  if (match != null) {
    logEvent.apexClassName = match[1];
    logEvent.type = 'ApexException';
  }
  // Hourly email limit
  if (logEvent.body.includes(`Approaching hourly email limit for this flow`)) {
    logEvent.type = 'HourlyEmailLimitWarning';
  }
  // Query limit
  if (logEvent.body.includes(`Too many SOQL queries`)) {
    logEvent.type = 'QueryLimitReached';
  }
  // Queue Limit
  if (logEvent.body.includes(`You've exceeded the limit of 100 jobs`)) {
    logEvent.type = 'QueueLimitReached';
  }
}

interface SESMessageFromSNS extends SESMessage {
  notificationType: string;
  content: string;
}

interface LogEventPayload {
  subject: string;
  body: string;
  flowName?: string;
  apexClassName?: string;
  type:
    | 'QueueLimitReached'
    | 'QueryLimitReached'
    | 'HourlyEmailLimitWarning'
    | 'FlowException'
    | 'ApexException'
    | 'Uncategorized';
}
