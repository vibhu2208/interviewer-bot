import * as aws from 'aws-sdk';

export type Event = {
  /**
   * Bucket, which should be cleaned up.
   */
  bucketName: string;

  /**
   * Regex patterns, s3 object keys will be tested against. If any pattern matches, object will be splitted.
   */
  keyPatterns: string[];
};

async function splitFile(s3: aws.S3, bucket: string, key: string) {
  // 16MB
  const chunkSizeBytes = 16 * 1024 * 1024;

  // will be updated to a real value after first request
  let maxBytes = Number.MAX_SAFE_INTEGER;

  let header: Buffer = Buffer.from([]);
  let reminder: Buffer = Buffer.from([]);

  for (let chunkIndex = 0; ; chunkIndex++) {
    const firstByteIndex = chunkIndex * chunkSizeBytes;
    const lastByteIndex = Math.min((chunkIndex + 1) * chunkSizeBytes - 1, maxBytes - 1);
    const byteRange = `bytes=${firstByteIndex}-${lastByteIndex}`;

    // request
    console.log(`Getting range ${bucket}/${key} (${byteRange})`);
    const getResponse = await s3.getObject({ Bucket: bucket, Key: key, Range: byteRange }).promise();

    // update the total size from response
    const contentRangeRaw = getResponse.ContentRange as string;
    // example: "bytes 0-10485759/192366305"
    maxBytes = Number(contentRangeRaw.split('/')[1]);
    if (Number.isNaN(maxBytes)) {
      throw new Error(`ContentRange parse error: ${contentRangeRaw}`);
    }

    // terminate, if there's only one chunk
    if (chunkIndex == 0 && maxBytes <= lastByteIndex + 1) {
      console.log('Only one chunk. Skip.');
      return;
    }

    const isLastChunk = maxBytes - lastByteIndex == 1;

    // save header
    const body = getResponse.Body as Buffer;
    let cleanBody = body;
    if (chunkIndex == 0) {
      header = body.slice(0, body.indexOf('\n') + Buffer.byteLength('\n'));
      console.log(`Header: ${header.toString().trimEnd()}`);
      cleanBody = body.slice(header.length, body.length);
    } else {
      // prepend last reminder
      if (reminder.length > 0) {
        cleanBody = Buffer.concat([reminder, cleanBody]);
      }
    }

    // save reminder after last row
    if (!isLastChunk) {
      const lastLineEnd = cleanBody.lastIndexOf('\n') + Buffer.byteLength('\n');
      reminder = cleanBody.slice(lastLineEnd, cleanBody.length);
      cleanBody = cleanBody.slice(0, lastLineEnd);
    }

    // write file
    const partKey = `${key}.${chunkIndex}.csv`;
    const partBody = Buffer.concat([header, cleanBody]);
    console.log(`Writing object ${partKey} <${partBody.length}>`);

    await s3
      .putObject({
        Bucket: bucket,
        Key: partKey,
        Body: partBody,
        ContentType: getResponse.ContentType,
      })
      .promise();

    // exit
    if (isLastChunk) {
      break;
    }
  }

  // delete big file
  console.log(`Deleting ${bucket}/${key}`);
  await s3.deleteObject({ Bucket: bucket, Key: key }).promise();
}

export async function handler(event: Event) {
  const s3 = new aws.S3();

  const patterns = event.keyPatterns.map((s) => new RegExp(s));

  let nextToken: string | undefined;

  const keysToSplit: string[] = [];

  do {
    const listResult = await s3.listObjectsV2({ Bucket: event.bucketName, ContinuationToken: nextToken }).promise();
    nextToken = listResult.NextContinuationToken;

    if (!listResult.Contents) {
      continue;
    }

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

      keysToSplit.push(key);
    }
  } while (nextToken);

  for (const key of keysToSplit) {
    await splitFile(s3, event.bucketName, key);
  }
}
