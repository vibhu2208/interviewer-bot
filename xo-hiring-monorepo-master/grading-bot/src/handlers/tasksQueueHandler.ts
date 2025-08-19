import { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { SQSBatchItemFailure } from 'aws-lambda/trigger/sqs';
import { Logger } from '../common/logger';
import { NonRetryableError } from '../common/non-retryable-error';
import { Config } from '../config';
import { incrementRetry, Sqs, SqsMessage } from '../integrations/sqs';
import { GradingBotSsmConfig, Ssm } from '../integrations/ssm';
import { gradeSubmissionPrepareTasks } from '../tasks/grade-submission-prepare-tasks';
import { processPromptExecutionMessage } from '../tasks/process-prompt-execution-message';
import { sendCallbackEvent } from '../tasks/send-status-event';

const log = Logger.create('tasksQueueHandler');

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  log.plain('EVENT', event);

  const ssmConfig = await Ssm.getForEnvironment();

  const promises = [];
  for (const record of event.Records) {
    try {
      const message: SqsMessage = JSON.parse(record.body);
      promises.push(processRecord(message, record, ssmConfig));
    } catch (e) {
      log.error(`Cannot parse SQS message`, e);
    }
  }

  const results = await Promise.all(promises);
  const failures = results.filter((it) => it != null) as SQSBatchItemFailure[];
  if (failures.length > 0) {
    log.error(`${failures.length} failed messages`, failures);
  }

  return {
    batchItemFailures: failures,
  };
}

async function processRecord(
  message: SqsMessage,
  record: SQSRecord,
  config: GradingBotSsmConfig,
): Promise<SQSBatchItemFailure | null> {
  const logContext = log.context(message);
  try {
    switch (message.type) {
      case 'grade-submission':
        await gradeSubmissionPrepareTasks(message, config);
        break;
      case 'send-grading-event':
        await sendCallbackEvent(message);
        break;
      case 'execute-prompt':
        await processPromptExecutionMessage(message);
        break;
    }
    return null;
  } catch (e) {
    if (e instanceof NonRetryableError) {
      log.error(`Unrecoverable error while grading submission: ${e.message}`, logContext);
      return null;
    }

    log.error('Error while grading submission', e, logContext);
    // Retry if possible
    if (message != null && (message.retries ?? 0) < Config.getNumRetires()) {
      log.debug(`Scheduling retry for message`, logContext);
      await Sqs.sendMessage(incrementRetry(message, (e as Error).message ?? `${e}`), 60);
      return null;
    }

    // Return a failure to SQS, message will be moved to DLQ
    return {
      itemIdentifier: record.messageId,
    };
  }
}
