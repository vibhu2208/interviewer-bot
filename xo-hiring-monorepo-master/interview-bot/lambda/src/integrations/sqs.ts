import { SendMessageBatchCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { v4 as uuid } from 'uuid';
import { Logger } from '../common/logger';
import { sliceIntoChunks } from '../common/util';
import { Config } from '../config';
import { CalibratedQuestionStatus } from '../model/calibrated-question';
import { CrossoverAssessmentStatusEvent } from './crossover';

const log = Logger.create('sqs-integration');
const client = new SQSClient({ region: Config.getRegion() });

/**
 * Number of minutes to wait between status event message retry
 */
const StatusEventMessageRetryPolicy = [0, 1, 5, 15, 15, 15];

export class Sqs {
  static async sendGptMessage(message: SqsGptMessage, delay?: number): Promise<void> {
    log.debug(`Sending message of type '${message.type}' to gpt queue`, message);
    await client.send(
      new SendMessageCommand({
        QueueUrl: Config.getGptQueueUrl(),
        MessageBody: JSON.stringify(message),
        DelaySeconds: delay,
      }),
    );
  }

  static async sendStatusEventMessage(message: SqsStatusEventMessage): Promise<void> {
    const delay =
      StatusEventMessageRetryPolicy[Math.min(message.retries ?? 0, StatusEventMessageRetryPolicy.length - 1)] * 60;
    log.debug(`Sending status message to the queue (delay=${delay}s)`, message);
    await client.send(
      new SendMessageCommand({
        QueueUrl: Config.getStatusEventQueueUrl(),
        MessageBody: JSON.stringify(message),
        DelaySeconds: delay,
      }),
    );
  }

  static async triggerPrepareSession(sessionId: string): Promise<void> {
    await Sqs.sendGptMessage({
      type: 'prepare-session',
      sessionId,
    });
  }

  static async triggerGenerateCalibratedQuestions(
    skillId: string,
    targetStatus?: CalibratedQuestionStatus,
    questionsCount?: number,
  ): Promise<void> {
    await Sqs.sendGptMessage({
      type: 'generate-questions',
      skillId,
      targetStatus,
      questionsCount,
    });
  }

  static async bulkSendGptMessages(messages: SqsGptMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    log.debug('SQS_BULK_MESSAGES', messages);
    const chunks = sliceIntoChunks(messages, 10);
    for (const chunk of chunks) {
      await client.send(
        new SendMessageBatchCommand({
          QueueUrl: Config.getGptQueueUrl(),
          Entries: chunk.map((it) => ({
            Id: uuid(),
            MessageBody: JSON.stringify(it),
          })),
        }),
      );
    }
  }
}

export interface RetryableMessage {
  retries?: number;
  errors?: string[];
}

export type SqsGptMessage =
  | SqsGptPrepareSessionMessage
  | SqsGenerateCalibratedQuestionsMessage
  | SqsGptGradeIndividualAnswerMessage
  | SqsGptAttemptUserPromptMessage
  | SqsGptCheckSessionExpirationMessage
  | SqsGptReGradeSessionMessage
  | SqsGptInterviewUserMessage
  | SqsGptMatchingInterviewUserMessage;

export interface SqsGptGradeIndividualAnswerMessage extends RetryableMessage {
  type: 'grade-individual-answer';
  sessionId: string;
  questionId: string;
}

export interface SqsGptAttemptUserPromptMessage extends RetryableMessage {
  type: 'attempt-user-prompt';
  sessionId: string;
  questionId: string;
  prompt: string;
}

export interface SqsGptPrepareSessionMessage extends RetryableMessage {
  type: 'prepare-session';
  sessionId: string;
}

export interface SqsGptCheckSessionExpirationMessage extends RetryableMessage {
  type: 'check-session-expiration';
  sessionId: string;
}

export interface SqsGenerateCalibratedQuestionsMessage extends RetryableMessage {
  type: 'generate-questions';
  skillId: string;
  targetStatus?: CalibratedQuestionStatus;
  questionsCount?: number;
}

export interface SqsStatusEventMessage extends RetryableMessage {
  type: 'status-event';
  sessionId: string;
  callbackUrl: string;
  payload: CrossoverAssessmentStatusEvent;
}

export interface SqsGptInterviewUserMessage extends RetryableMessage {
  type: 'interview-user-message';
  sessionId: string;
  questionId: string;
  forceGrading?: boolean;
}

export interface SqsGptReGradeSessionMessage extends RetryableMessage {
  type: 'regrade-session';
  sessionId: string;
  error?: string;
}

export interface SqsGptMatchingInterviewUserMessage extends RetryableMessage {
  type: 'matching-interview-user-message';
  sessionId: string;
  questionId: string;
  forceGrading?: boolean;
}

export function incrementRetry<T extends RetryableMessage>(message: T, error: any): T {
  message.retries = (message.retries ?? 0) + 1;
  message.errors = [`${new Date().toISOString()}: ${error}`, ...(message.errors ?? [])];
  return message;
}
