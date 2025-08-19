import * as AWS from 'aws-sdk';

import fileType from 'image-type';

import sanitize from 'sanitize-filename';

import atob from 'atob';

import { z } from 'zod';

const s3 = new AWS.S3();

const jpgExtensions = ['jpg', 'JPG', 'jpeg', 'JPEG'];
const otherExtensions = ['png', 'PNG', 'gif', 'GIF', 'svg', 'SVG', 'bmp', 'BMP'];

if (process.env.bucketName === undefined) {
  throw new Error("Env variable 'bucketName' is not set.");
}
const bucketName = process.env.bucketName;

const corsHeaders = {
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,pragma',
  'Access-Control-Allow-Methods': 'GET,OPTIONS,POST',
  'Access-Control-Allow-Origin': '*',
};

const requestType = z.object({ avatarFileName: z.string(), avatarFileContent: z.string() });

export async function handler(event: {
  isBase64Encoded?: boolean | undefined;
  body: string;
  pathParameters: { id: string };
}) {
  // Decode base64-encoded payload
  event.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  event.isBase64Encoded = false;

  const request = requestType.parse(JSON.parse(event.body));

  const lastIndexOfDot = request.avatarFileName.lastIndexOf('.');
  if (lastIndexOfDot === -1) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Please add file extension to filename.' }),
      headers: corsHeaders,
    };
  }

  const fileNameInputSplittedByDot = request.avatarFileName.split('.');
  const type = fileNameInputSplittedByDot[fileNameInputSplittedByDot.length - 1];
  if (!jpgExtensions.includes(type) && !otherExtensions.includes(type)) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: `${type.toLowerCase()} image type not supported. Please use one of the supported types [jpg, png, gif, svg, bmp]`,
      }),
      headers: corsHeaders,
    };
  }

  const candidateId = event.pathParameters.id;
  const base64String = request.avatarFileContent;
  const dstKey = `${candidateId}-avatar`;
  const buffer = Buffer.from(base64String.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  const mimeInfo = fileType(buffer);

  try {
    if (type === 'svg' || type === 'SVG') {
      const base64data = atob(base64String.replace('data:image/svg+xml;base64,', ''));
      if (!base64data.startsWith('<?xml') || !base64data.endsWith('</svg>')) {
        throw new Error('Invalid image');
      }
    } else if (
      mimeInfo === null ||
      (!jpgExtensions.includes(mimeInfo.ext) && !otherExtensions.includes(mimeInfo.ext))
    ) {
      throw new Error('Invalid image');
    }
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: `Invalid image. Please use one of the supported types [jpg, png, gif, svg, bmp]`,
      }),
      headers: corsHeaders,
    };
  }

  let contentType = 'image/' + type.toLowerCase();
  if (jpgExtensions.includes(type)) {
    contentType = 'image/jpeg';
  }

  let urlStr = '';

  // Upload the image to the destination bucket
  const destparams = {
    Bucket: bucketName,
    Key: dstKey,
    Body: buffer,
    ContentEncoding: 'base64',
    ContentType: contentType,
  };

  const putResult = await s3.upload(destparams).promise();
  urlStr = putResult.Location;

  if (!urlStr.includes(bucketName) || !urlStr.includes(candidateId)) {
    console.error('Image url should include bucketName and candidateId');
  }

  console.log('Successfully uploaded to ' + bucketName + '/' + dstKey);

  return {
    statusCode: 200,
    body: JSON.stringify({ url: urlStr }),
    headers: corsHeaders,
  };
}
