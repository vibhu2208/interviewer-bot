import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SQSEvent } from 'aws-lambda';
import { SQSBatchResponse } from 'aws-lambda/trigger/sqs';
import { VeriffClient } from '../internal-handlers/integrations/veriff';
import { logger } from '../logger';

const veriffMediaBucketName = process.env.VERIFF_MEDIA_BUCKET;
const clientS3 = new S3Client({ region: process.env.AWS_REGION });

export interface VeriffMediaEvent {
  candidateId: string;
  sessionId: string;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const veriffClient = await VeriffClient.default();

  for (const record of event.Records) {
    try {
      const mediaEvent = JSON.parse(record.body) as VeriffMediaEvent;

      const media = await veriffClient.listMedia(mediaEvent.sessionId);
      if (media.status !== 'success') {
        logger.info('No data received from Veriff media');
        continue;
      }
      logger.info(`Candidate has ${media.images.length} images and ${media.videos.length} videos`, {
        mediaEvent,
      });

      // Download images
      for (const image of media.images) {
        const content = await veriffClient.getMediaContent(image.id);
        await clientS3.send(
          new PutObjectCommand({
            Bucket: veriffMediaBucketName,
            Key: `${mediaEvent.candidateId}/${mediaEvent.sessionId}/${image.context}`,
            Body: content,
            Metadata: {
              sessionId: mediaEvent.sessionId,
              mimeType: image.mimetype,
              id: image.id,
            },
          }),
        );
        logger.info(`Saving ${image.context} image for candidate ${mediaEvent.candidateId}`);
      }
    } catch (e) {
      logger.error('Cannot fetch Veriff media for event', {
        record,
        error: e,
      });
    }
  }

  return {
    batchItemFailures: [],
  };
}
