import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { logger } from '../logger';
import { invokeApexrest } from '../resources/salesforce-apexrest';
import { VeriffMediaEvent } from '../veriff-media/queue-handler';
import { VeriffEventPayload } from './integrations/veriff';

const veriffMediaBucketName = process.env.VERIFF_MEDIA_BUCKET;
const veriffQueueUrl = process.env.VERIFF_MEDIA_QUEUE_URL ?? null;
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });
const clientS3 = new S3Client({ region: process.env.AWS_REGION });

export class VeriffEvents {
  public static async handleDecision(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    const response = invokeApexrest(event, 'post', 'webhook/veriff/decision');

    // If the request is not valid the error will be thrown above, and we will not process this logic
    // We want to fetch and store media data for approved candidates
    try {
      const veriffData: VeriffEventPayload = JSON.parse(event.body ?? '{}');
      if (veriffData.status === 'success' && veriffData.verification.status === 'approved') {
        // Add message to the queue to fetch veriff media
        if (veriffQueueUrl != null) {
          await sqsClient.send(
            new SendMessageCommand({
              QueueUrl: veriffQueueUrl,
              MessageBody: JSON.stringify({
                candidateId: veriffData.verification.vendorData,
                sessionId: veriffData.verification.id,
              } as VeriffMediaEvent),
            }),
          );
          logger.info('Added Veriff media event to sqs', { veriffData });

          // Store payload in the bucket
          await clientS3.send(
            new PutObjectCommand({
              Bucket: veriffMediaBucketName,
              Key: `${veriffData.verification.vendorData}/${veriffData.verification.id}/payload.json`,
              Body: JSON.stringify(veriffData, null, 2),
              Metadata: {
                sessionId: veriffData.verification.id,
              },
            }),
          );
          logger.info(`Saved event payload to the ${veriffData.verification.vendorData}/payload.json`);
        } else {
          logger.error('env VERIFF_MEDIA_QUEUE_URL is not defined');
        }
      }
    } catch (e) {
      logger.error('Cannot queue Veriff media event', e as Error);
    }

    return response;
  }

  public static async handleEvent(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    return invokeApexrest(event, 'post', 'webhook/veriff/event');
  }
}
