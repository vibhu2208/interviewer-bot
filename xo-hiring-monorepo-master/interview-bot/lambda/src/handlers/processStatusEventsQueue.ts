import { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import axios from 'axios';
import { Duration } from 'luxon';
import { Logger } from '../common/logger';
import { incrementRetry, Sqs, SqsStatusEventMessage } from '../integrations/sqs';

const log = Logger.create('processStatusEventsQueue');

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  log.plain('EVENT', event);

  const promises = [];
  for (const record of event.Records) {
    const message: SqsStatusEventMessage = JSON.parse(record.body);
    promises.push(processMessage(message, record));
  }

  const results = (await Promise.all(promises)).filter((it) => it != null) as string[];

  return {
    batchItemFailures: results.map((it) => ({ itemIdentifier: it })),
  };
}

/**
 * @return null if processed successfully. message id if processing failed
 */
async function processMessage(message: SqsStatusEventMessage, record: SQSRecord): Promise<string | null> {
  let error = '';
  try {
    log.info(`Sending status event message to XO Salesforce`, log.context(message));
    log.plain(`EVENT_MESSAGE`, JSON.stringify(message, null, 2));
    const response = await axios.request({
      method: 'put',
      url: message.callbackUrl,
      data: message.payload,
      timeout: Duration.fromObject({ minute: 2 }).toMillis(),
    });
    if (response.data.success === true) {
      log.info(`Status event received successfully`, log.context(message));
      return null;
    }
    error = `Incorrect response: (${response.status})`;
  } catch (e: any) {
    log.error('Error while sending status event to XO Salesforce', e, log.context(message));
    error = e.message;
  }

  // If we reach this point then something went wrong
  if ((message.retries ?? 0) < 5) {
    log.info(`Scheduling retry for status message`, log.context(message));
    await Sqs.sendStatusEventMessage(incrementRetry(message, error));
    return null;
  }

  // If we've reached max amount of retry we fail this message
  // SQS will route it to dead-letter queue
  return record.messageId;
}
