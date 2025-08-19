import AWS from 'aws-sdk';
import { Metadata } from 'aws-sdk/clients/s3';

export type S3Resource = {
  data: Buffer;
  metadata: Metadata;
};

const s3 = new AWS.S3({ region: process.env.AWS_REGION });

export class S3Utils {
  protected readonly bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
  }

  async downloadS3File(key: string): Promise<S3Resource | undefined> {
    try {
      const s3Object = await s3
        .getObject({
          Bucket: this.bucketName,
          Key: key,
        })
        .promise();
      return {
        data: s3Object.Body as Buffer,
        metadata: s3Object.Metadata,
      } as S3Resource;
    } catch (err) {
      console.error(`Failed to download resource from bucket with id: ${key}`, err);
      return undefined;
    }
  }
}
