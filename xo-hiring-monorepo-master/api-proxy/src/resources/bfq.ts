import { APIGatewayProxyEvent } from 'aws-lambda';
import { S3 } from 'aws-sdk';
import { AxiosResponse, AxiosResponseHeaders, InternalAxiosRequestConfig, RawAxiosResponseHeaders } from 'axios';
import { logger } from '../logger';
import { IdPathParameter } from '../validation';
import { parse } from 'jsonc-parser';
import Ajv from 'ajv';

const s3 = new S3();
const ajv = new Ajv();

export type StandardBfqConfig = {
  bucketName: string;
  answersPrefix: string;
  answersSchemaKey: string;
  questionsSchemaKey: string;
};

export const getStandardBfqConfig = () =>
  ({
    bucketName: process.env.S3_BUCKET_BFQ as string,
    answersPrefix: 'answers',
    answersSchemaKey: 'config/bfq-answers.schema.json',
    questionsSchemaKey: 'config/bfq-questions.jsonc',
  } as StandardBfqConfig);

export const getStandardBfqJobRoleConfig = () =>
  ({
    bucketName: process.env.S3_BUCKET_BFQ as string,
    answersPrefix: 'answers-job-role',
    answersSchemaKey: 'config/bfq-answers-job-role.schema.json',
    questionsSchemaKey: 'not-available',
  } as StandardBfqConfig);

const getJsonConfig = async (configFileKey: string, bucketName: string): Promise<Record<string, unknown>> => {
  // Retrieve from S3
  const params = {
    Bucket: bucketName,
    Key: configFileKey,
  };
  logger.info(`Retrieving ${configFileKey} from ${bucketName}`);
  const data = await s3.getObject(params).promise();
  if (data.Body) {
    let jsonContent: Record<string, unknown> | undefined = undefined;
    if (configFileKey.endsWith('.jsonc')) {
      jsonContent = parse(data.Body.toString());
    }
    if (configFileKey.endsWith('.json')) {
      jsonContent = JSON.parse(data.Body.toString());
    }
    if (jsonContent !== undefined) {
      return jsonContent;
    }
    logger.info(`Failed to parse config ${configFileKey} from bucket ${bucketName}`);
    throw new Error('Failed to parse config');
  }
  logger.info(`Failed to load config ${configFileKey} from bucket ${bucketName}: s3.getObject returned empty Body`);
  throw new Error(`Failed to load config`);
};

export const standardBfqAnswersGet = async (
  event: APIGatewayProxyEvent,
  config: StandardBfqConfig,
): Promise<AxiosResponse> => {
  const id = new IdPathParameter(event).toString();

  const params = {
    Bucket: config.bucketName,
    Key: `${config.answersPrefix}/${id}`,
  };

  try {
    const data = await s3.getObject(params).promise();
    if (data.Body) {
      return createAxiosResponse(200, data.Body.toString());
    }
  } catch (error) {
    // ignore the error - as it's normal not to have S3 object for candidate at the very beginning of BFQ process
  }
  return createAxiosResponse(204, '');
};

export const standardBfqAnswersPost = async (
  event: APIGatewayProxyEvent,
  config: StandardBfqConfig,
): Promise<AxiosResponse> => {
  const id = new IdPathParameter(event).toString();
  const { body } = event;
  const payload: Record<string, unknown> = JSON.parse(body as string);
  const configFile = await getJsonConfig(config.answersSchemaKey, config.bucketName);
  const validator = ajv.compile(configFile);
  const isValid = validator(payload);
  if (isValid) {
    payload.lastUpdate = new Date().toISOString();
    await s3
      .putObject({
        Bucket: config.bucketName,
        Key: `${config.answersPrefix}/${id}`,
        Body: JSON.stringify(payload),
      })
      .promise();

    return createAxiosResponse(200, {
      message: 'Answers successfully accepted',
      errorCode: null,
    });
  } else {
    logger.error('Schema validation errors: ', {
      errors: validator.errors,
    });
    throw new Error('Input does not match the json schema');
  }
};

export const standardBfqsGet = async (
  event: APIGatewayProxyEvent,
  config: StandardBfqConfig,
): Promise<AxiosResponse> => {
  const jsonObject = await getJsonConfig(config.questionsSchemaKey, config.bucketName);
  return createAxiosResponse(200, jsonObject);
};

function createAxiosResponse<T>(
  status: number,
  data: T,
  headers?: RawAxiosResponseHeaders | AxiosResponseHeaders,
  config?: InternalAxiosRequestConfig,
): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: 'OK',
    headers: headers ?? {},
    config: config ?? { headers: {} as AxiosResponseHeaders },
  };
}
