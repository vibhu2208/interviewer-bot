import * as aws from 'aws-sdk';

export type Event = {
  /**
   * Bucket, which should be cleaned up.
   */
  bucketName: string;
  /**
   * Regex patterns, s3 object keys will be tested against. If any pattern matches, object will be deleted.
   *
   * Example of deleting everything under amplify-builds/ folder: ['^amplify-builds\\/']
   */
  keyPatterns: string[];
};

export async function handler(event: Event) {
  const s3 = new aws.S3();

  const patterns = event.keyPatterns.map((s) => new RegExp(s));

  let nextToken: string | undefined;
  do {
    const listResult = await s3.listObjectsV2({ Bucket: event.bucketName, ContinuationToken: nextToken }).promise();
    nextToken = listResult.NextContinuationToken;

    const keysToDelete: string[] = [];

    if (listResult.Contents) {
      console.log(`Listed ${listResult.Contents.length} objects in ${event.bucketName}.`);
      for (const object of listResult.Contents) {
        if (!object.Key) {
          continue;
        }
        const key = object.Key;
        const matchedIndex = patterns.findIndex((p) => p.test(key));
        if (matchedIndex < 0) {
          continue;
        }
        console.log(`Selected key with pattern /${patterns[matchedIndex]}/: ${key}`);
        keysToDelete.push(key);
      }
    }

    if (keysToDelete.length > 0) {
      const deleteResult = await s3
        .deleteObjects({ Bucket: event.bucketName, Delete: { Objects: keysToDelete.map((k) => ({ Key: k })) } })
        .promise();
      console.log(`Deleted ${deleteResult.Deleted?.length} keys`);
      if (deleteResult.Errors) {
        for (const error of deleteResult.Errors) {
          console.log(`[${error?.Code}] Failed to delete key: '${error?.Key}'. Message: ${error?.Message}`);
        }
      }
    }
  } while (nextToken);
}
