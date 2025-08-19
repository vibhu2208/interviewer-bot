import { z } from 'zod';
import * as AWS from 'aws-sdk';
import { DEFAULT_DATE_DIFF } from './constants';
import { AxiosInstance } from 'axios';
import { getSalesforceClientWithCustomCredentials } from '@trilogy-group/xo-hiring-integration';

export const ServiceAccountConfigType = z
  .object({
    authEndpoint: z.string().url(),
    clientId: z.string(),
    clientSecret: z.string(),
    username: z.string(),
    password: z.string(),
    securityToken: z.string(),
  })
  .passthrough();

export type ServiceAccountConfig = z.infer<typeof ServiceAccountConfigType>;

export const OpenSearchConfigType = z
  .object({
    serviceName: z.string(),
    aliasName: z.string(),
    dateDiff: z.number().optional().default(DEFAULT_DATE_DIFF),
  })
  .passthrough();

export type OpenSearchConfig = z.infer<typeof OpenSearchConfigType>;

export async function readConfig<T>(
  alternativeNames: string[],
  decrypt: boolean,
  configType: { parse: (d: unknown) => T },
): Promise<T> {
  console.log(`Checking '${alternativeNames.join(', ')}' parameter values.`);
  const ssm = new AWS.SSM();
  const getParametersResult = await ssm.getParameters({ Names: alternativeNames, WithDecryption: decrypt }).promise();
  for (const name of alternativeNames) {
    const parameter = getParametersResult.Parameters?.find((p) => p.Name === name && p.Value !== undefined);
    if (parameter) {
      console.log(`Selected '${name}' parameter.`);
      return configType.parse(JSON.parse(parameter.Value as string) as unknown);
    }
  }
  throw new Error('None of the requested parameters exist.');
}

interface InitLambdaResponse {
  config: OpenSearchConfig;
}
export async function initLambda(): Promise<InitLambdaResponse> {
  if (!process.env.SSM_PARAMETER_CONFIG) {
    throw new Error('Required env vars are missing: SSM_PARAMETER_CONFIG');
  }

  const config = await readConfig(process.env.SSM_PARAMETER_CONFIG.split(','), false, OpenSearchConfigType);

  return {
    config,
  };
}

interface InitLambdaWithSfClientResponse {
  config: OpenSearchConfig;
  sfClient: AxiosInstance;
}
export async function initLambdaWithSfClient(): Promise<InitLambdaWithSfClientResponse> {
  if (!process.env.SSM_PARAMETER_SERVICE_ACCOUNT) {
    throw new Error('Required env vars are missing: SSM_PARAMETER_SERVICE_ACCOUNT');
  }

  const { config } = await initLambda();

  const serviceAccountConfig = await readConfig(
    process.env.SSM_PARAMETER_SERVICE_ACCOUNT.split(','),
    true,
    ServiceAccountConfigType,
  );

  const sfClient = await getSalesforceClientWithCustomCredentials({
    client_id: serviceAccountConfig.clientId,
    client_secret: serviceAccountConfig.clientSecret,
    username: serviceAccountConfig.username,
    password: serviceAccountConfig.password + serviceAccountConfig.securityToken,
  });

  return {
    config,
    sfClient,
  };
}
