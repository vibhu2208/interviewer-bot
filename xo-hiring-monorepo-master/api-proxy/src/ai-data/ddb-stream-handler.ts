import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { defaultLogger } from '@trilogy-group/xoh-integration';
import { AttributeValue, DynamoDBStreamEvent } from 'aws-lambda';
import { envVal, MainTableKeys } from '../internal-handlers/integrations/dynamodb';
import { isSpotlightTask, SpotlightTaskDocument } from './spotlight-task.model';
import { TaskStatus } from './task.model';
import { ApplyEmailTaskDocument, isApplyEmailTask } from './apply-email-task.model';

const log = defaultLogger({ serviceName: 'ai-data-stream' });
const lambdaClient = new LambdaClient({});

export async function handler(event: DynamoDBStreamEvent): Promise<void> {
  const processRecords = event.Records.map(async (record) => {
    if (!['INSERT', 'MODIFY'].includes(record.eventName ?? '')) {
      return;
    }

    const newImage = decode<MainTableKeys>(record.dynamodb?.NewImage);
    const oldImage = decode<MainTableKeys>(record.dynamodb?.OldImage);

    if (newImage == null) {
      return;
    }

    if (
      isSpotlightTask(newImage) &&
      newImage.status === TaskStatus.PROGRESS &&
      newImage.status !== (oldImage as SpotlightTaskDocument)?.status
    ) {
      await invokeTaskLambda('SPOTLIGHT_LAMBDA_NAME', newImage);
    } else if (
      isApplyEmailTask(newImage) &&
      newImage.status === TaskStatus.PROGRESS &&
      newImage.status !== (oldImage as ApplyEmailTaskDocument)?.status
    ) {
      await invokeTaskLambda('APPLY_EMAIL_LAMBDA_NAME', newImage);
    }
  });

  await Promise.all(processRecords);
}

/**
 * We're not throwing anything here because we don't want to block the stream processing
 * @param doc
 */
async function invokeTaskLambda<T extends MainTableKeys>(lambdaNameVar: string, doc: T): Promise<void> {
  const lambdaName = envVal(lambdaNameVar);
  if (lambdaName == null) {
    return;
  }

  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: lambdaName,
        InvocationType: 'Event', // Asynchronous invocation
        Payload: JSON.stringify({
          pk: doc.pk,
          sk: doc.sk,
        }),
      }),
    );
  } catch (e) {
    log.error('Error invoking Spotlight Lambda:', e as Error);
  }
}

function decode<T>(ddbRawData: { [p: string]: AttributeValue } | undefined): T | null {
  if (ddbRawData == null) {
    return null;
  }
  // @ts-ignore AWS Libraries seems to have a bit of typing clash here
  return unmarshall(ddbRawData) as T;
}
