import { APIGatewayProxyEvent } from 'aws-lambda';
import { S3 } from 'aws-sdk';
import { AxiosResponse } from 'axios';
import { readResumeFileFromLinkedIn } from '../internal-handlers/integrations/linkedin';
import { logger } from '../logger';
import { axiosResponse } from '../responses';
import { IdPathParameter } from '../validation';

const s3 = new S3();

export const downloadResume = async (event: APIGatewayProxyEvent, bucketName: string): Promise<AxiosResponse> => {
  if (!(await resumeExists(event, bucketName))) {
    return axiosResponse(404, {
      message: 'No file found for the candidate',
      fileName: '',
      errorCode: 'NOT_FOUND',
    });
  }
  const id = new IdPathParameter(event).toString();
  try {
    const params = { Bucket: bucketName, Key: id };
    const s3Response = await s3.headObject(params).promise();
    const metadata = s3Response.Metadata || {};
    const originalFileName = metadata['original-file-name'];
    const fileName = originalFileName ?? 'resume_' + id;
    const preSignedUrl = await s3.getSignedUrlPromise('getObject', {
      Bucket: bucketName,
      Key: id,
      Expires: 60 * 60, // 1 hour
    });

    return axiosResponse(200, {
      url: preSignedUrl,
      fileName,
    });
  } catch (err) {
    logger.error('Error downloading file', err as Error);
    return axiosResponse(500, {
      message: 'File download failed with internal server error',
      fileName: '',
      errorCode: 'SERVER_ERROR',
    });
  }
};

export const uploadResume = async (event: APIGatewayProxyEvent, bucketName: string) => {
  const id = new IdPathParameter(event).toString();
  const { body } = event;
  const { ResumeFileName, ResumeFileContent, ResumeFileDate, ResumeId } = JSON.parse(body as string);

  let newerResumeExists = false;
  if (ResumeFileDate) {
    try {
      const getObjectResult = await s3.headObject({ Bucket: bucketName, Key: id }).promise();
      // The object exists
      const existingFileDate = new Date(getObjectResult.LastModified as Date);
      const uploadedFileDate = new Date(ResumeFileDate);
      newerResumeExists = existingFileDate > uploadedFileDate;
    } catch (err) {
      // The object does not exist
      newerResumeExists = false;
    }
  }

  if (newerResumeExists) {
    return axiosResponse(200, {
      message: 'There is a newer file',
      fileName: ResumeFileName,
      errorCode: null,
    });
  }

  let resume: Buffer | null = null;

  if (ResumeFileContent) {
    logger.info('Reading resume from base64 content');
    resume = Buffer.from(ResumeFileContent, 'base64');
  } else if (ResumeId) {
    logger.info('Reading resume from LinkedIn');
    resume = await readResumeFileFromLinkedIn(ResumeId);
  }

  if (!resume) {
    logger.error('No resume content provided');

    return axiosResponse(500, {
      message: 'File upload failed with internal server error',
      fileName: ResumeFileName,
      errorCode: 'SERVER_ERROR',
    });
  }

  return await uploadResumeToS3(bucketName, id, ResumeFileName, resume);
};

/**
 * Upload a resume to S3
 */
export const uploadResumeToS3 = async (bucketName: S3.BucketName, key: string, fileName: string, body: Buffer) => {
  try {
    await s3
      .putObject({
        Bucket: bucketName,
        Key: key,
        Body: body,
        Metadata: {
          'original-file-name': encodeURIComponent(fileName),
          'original-file-extension': encodeURIComponent(getFileExtension(fileName)),
        },
      })
      .promise();
    return axiosResponse(200, {
      message: 'File upload successful',
      fileName: fileName,
      errorCode: null,
    });
  } catch (err) {
    logger.info('Error uploading file', err as Error);
    return axiosResponse(500, {
      message: 'File upload failed with internal server error',
      fileName: '',
      errorCode: 'SERVER_ERROR',
    });
  }
};

export const resumeExists = async (event: APIGatewayProxyEvent, bucketName: string): Promise<boolean> => {
  const id = new IdPathParameter(event).toString();
  try {
    await s3.headObject({ Bucket: bucketName, Key: id }).promise();
    // The object exists
    return true;
  } catch (err) {
    // The object does not exist
    return false;
  }
};

function getFileExtension(fileName: string | null | undefined): string {
  if (!fileName) {
    return '';
  }
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) {
    return '';
  }
  return fileName.substring(dotIndex + 1).toLowerCase();
}
