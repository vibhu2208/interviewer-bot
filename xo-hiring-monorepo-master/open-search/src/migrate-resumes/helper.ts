import { S3 } from 'aws-sdk';
import { AxiosInstance } from 'axios';

const s3 = new S3();

interface DownloadResumeResult {
  VersionData: string;
  PathOnClient: string;
  FileExtension: string;
  errorCode?: string;
  message?: string;
}

export const migrate = async (bucketName: string, rows: object[], sfClient: AxiosInstance) => {
  const downloadPromises: Promise<void>[] = [];

  for (const row of rows) {
    // @ts-ignore
    const id: string = row['candidateId'];

    const downloadPromise = resumeExists(id, bucketName)
      .then((resumeExists) => {
        if (resumeExists) {
          console.log(`Skipping. Resume exists for ${id}`);
        } else {
          return downloadResume(id, sfClient).then((sfResume) => uploadResume(id, sfResume, bucketName));
        }
      })
      .catch((err) => {
        console.log(`Skipping. There was an error with ${id}`);
        console.log({
          candidateId: id,
          error: err,
        });
      });

    downloadPromises.push(downloadPromise);
  }

  await Promise.all(downloadPromises);
};

const downloadResume = async (id: string, sfClient: AxiosInstance): Promise<DownloadResumeResult> => {
  // make an API call to SF download-resume
  const sfResponse = await sfClient.request({
    method: 'get',
    url: `/services/apexrest/candidates/${id}/download-resume`,
    responseType: 'arraybuffer', // Add this line to handle binary data
  });

  // Extract the file name and extension from the Content-Disposition header
  const contentDisposition = sfResponse.headers['content-disposition'];
  const fileNameMatch = contentDisposition.match(/filename="(.+)?"/);
  const fileName = fileNameMatch ? fileNameMatch[1] : '';
  const fileExtension = fileName.split('.').pop() || '';

  return {
    VersionData: Buffer.from(sfResponse.data, 'binary').toString('base64'),
    PathOnClient: fileName,
    FileExtension: fileExtension,
  };
};

const uploadResume = async (id: string, sfResume: DownloadResumeResult, bucketName: string) => {
  await s3
    .putObject({
      Bucket: bucketName as S3.BucketName,
      Key: id,
      Body: Buffer.from(sfResume.VersionData, 'base64'),
      Metadata: {
        'original-file-name': encodeURIComponent(sfResume.PathOnClient),
        'original-file-extension': encodeURIComponent(sfResume.FileExtension),
      },
    })
    .promise();
};

const resumeExists = async (id: string, bucketName: string): Promise<boolean> => {
  try {
    await s3.headObject({ Bucket: bucketName, Key: id }).promise();
    // The object exists
    return true;
  } catch (err) {
    // The object does not exist
    return false;
  }
};
