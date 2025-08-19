import { APICallError, NoObjectGeneratedError } from 'ai';
import { SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { Logger } from '../common/logger';
import { NonRetryableError } from '../common/non-retryable-error';
import { Config } from '../config';
import { Sns } from '../integrations/sns';
import { incrementRetry, Sqs, SqsGptMessage } from '../integrations/sqs';
import { checkSessionExpiration } from '../tasks/checkSessionExpiration';
import { gptAttemptUserPrompt } from '../tasks/gptAttemptUserPrompt';
import { gptGenerateCalibratedQuestions } from '../tasks/gptGenerateCalibratedQuestions';
import { gptGradeIndividualAnswer } from '../tasks/gptGradeIndividualAnswer';
import { gptInterviewUserMessage } from '../tasks/gptInterviewUserMessage';
import { gptMatchingInterviewUserMessage } from '../tasks/gptMatchingInterviewUserMessage';
import { gptPrepareQuestionsForSession } from '../tasks/gptPrepareQuestionsForSession';
import { reGradeSession } from '../tasks/reGradeSession';

const log = Logger.create('processGptCommandQueue');

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  log.plain('EVENT', event);

  const promises = [];
  for (const record of event.Records) {
    const message: SqsGptMessage = JSON.parse(record.body);
    promises.push(processMessage(message, record));
  }

  const results = (await Promise.all(promises)).filter((it) => it != null) as string[];

  return {
    batchItemFailures: results.map((it) => ({ itemIdentifier: it })),
  };
}

async function processMessage(message: SqsGptMessage, record: SQSRecord): Promise<string | null> {
  try {
    switch (message.type) {
      case 'prepare-session':
        await gptPrepareQuestionsForSession(message);
        break;
      case 'generate-questions':
        await gptGenerateCalibratedQuestions(message);
        break;
      case 'grade-individual-answer':
        await gptGradeIndividualAnswer(message);
        break;
      case 'attempt-user-prompt':
        await gptAttemptUserPrompt(message);
        break;
      case 'interview-user-message':
        await gptInterviewUserMessage(message);
        break;
      case 'matching-interview-user-message':
        await gptMatchingInterviewUserMessage(message);
        break;
      case 'check-session-expiration':
        await checkSessionExpiration(message);
        break;
      case 'regrade-session':
        await reGradeSession(message);
        break;
    }
    return null;
  } catch (e: any) {
    log.error(`Error while processing gpt message (${message.type})`, e, log.context(message));

    if (NoObjectGeneratedError.isInstance(e)) {
      log.error(`NoObjectGeneratedError: ${e.name}, ${e.cause}, ${e.text}`, log.context(message));
    }

    if (e instanceof NonRetryableError) {
      log.info(`Caught NonRetryableError for (${message.type}), stopping processing`, log.context(message));
      return null;
    }

    const delayInMinutes = APICallError.isInstance(e) ? 15 : 3;

    // We want to retry several times
    if ((message.retries ?? 0) < Config.getGptMessagesNumRetries()) {
      log.info(`Scheduling retry for gpt message (${message.type})`, log.context(message));
      await Sqs.sendGptMessage(incrementRetry(message, e.message), delayInMinutes * 60);
      return null;
    }

    log.warn(`Reached retry limit, rejecting the message (${message.type}) to DLQ`, log.context(message));
    if (message.type === 'grade-individual-answer') {
      await Sns.publishMessage(
        `Reached retry limit, rejecting the message (${message.type}) to DLQ`,
        JSON.stringify(message, null, 2),
      );
    }
    return record.messageId;
  }
}
