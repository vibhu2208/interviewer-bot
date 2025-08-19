import { defaultLogger } from '@trilogy-group/xoh-integration';
import { SQSEvent } from 'aws-lambda';
import { SQSBatchResponse } from 'aws-lambda/trigger/sqs';
import { TaskMessage } from '../models/messages';
import { generateSummary } from '../tasks/generate-summary';
import { onboardInterviewer } from '../tasks/onboard-interviewer';

const log = defaultLogger({ serviceName: 'tasks-processor' });

export async function processTasks(event: SQSEvent): Promise<SQSBatchResponse> {
  // Process messages in parallel
  const processingPromises = event.Records.map(async (record) => {
    try {
      // Parse the message body as a TaskMessage type
      const message: TaskMessage = JSON.parse(record.body);

      if (message.transcriptId != null) {
        log.info(`Processing message: ${message.type}`, {
          asrId: message.transcriptId, // Typically it would be the ASR id
        });
      }

      // Type-safe handling of different message types
      switch (message.type) {
        case 'generate-summary':
          await generateSummary(message.transcriptId, message.promptId);
          break;
        case 'onboard-interviewer':
          await onboardInterviewer(message.transcriptId);
          break;
        default:
          log.warn(`Unknown message type: ${(message as any).type}`);
      }
      return null;
    } catch (error) {
      log.error('Error processing message', error as Error);
      return record.messageId; // Failure
    }
  });

  // Wait for all processing to complete and collect failures
  const results = await Promise.all(processingPromises);

  // Filter out and return failed message IDs
  const batchItemFailures = results
    .filter((result): result is string => result !== null)
    .map((messageId) => ({ itemIdentifier: messageId }));

  // Return batch item failures to SQS for retry
  return {
    batchItemFailures,
  };
}
