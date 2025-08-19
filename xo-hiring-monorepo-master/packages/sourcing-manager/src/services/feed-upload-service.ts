import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { defaultLogger } from '@trilogy-group/xoh-integration';

const log = defaultLogger({ serviceName: 'feed-upload-service' });

const s3Client = new S3Client();

export class FeedUploadService {
  static async uploadXMLToS3Bucket(key: string, content: string, bucket?: string): Promise<void> {
    if (bucket == null) {
      if (process.env.OUTPUT_BUCKET == null) {
        throw new Error('OUTPUT_BUCKET env variable is required because bucket name is not defined');
      }
      bucket = process.env.OUTPUT_BUCKET;
    }

    const s3Path = `s3://${bucket}/${key}`;

    log.info(`Saving XML feed to S3 bucket: ${s3Path}`);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: 'application/xml',
      }),
    );
    log.info(`XML feed successfully saved to ${s3Path}`);
  }
}
