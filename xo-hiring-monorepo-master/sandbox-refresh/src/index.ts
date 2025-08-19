import * as AWS from 'aws-sdk';
import { SafeParseReturnType, z } from 'zod';
import { AxiosError, AxiosInstance } from 'axios';
import { getSalesforceClientWithCustomCredentials } from '@trilogy-group/xo-hiring-integration';

const env = throwIfNotParsed(
  'process environment variables',
  z
    .object({
      ENV: z.string(),
      SECRETS_KEY: z.string(),
      AWS_REGION: z.string().default('us-east-1'),
      SF_API_URL: z.string().default('https://crossover.my.salesforce.com'),
      SF_API_VERSION: z.string().default('52.0'),
    })
    .safeParse(process.env),
);

const sandboxRefreshRequestEventType = z.union([
  z.object({
    action: z.literal('refresh'),
    sandboxName: z.string(),
  }),
  z.object({
    action: z.literal('list'),
  }),
]);

const serviceUserInfoType = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  username: z.string(),
  password: z.string(),
  secretToken: z.string(),
});

type ServiceUserInfo = z.infer<typeof serviceUserInfoType>;

const listDataType = z.object({
  totalSize: z.number(),
  done: z.literal(true),
  records: z.array(
    z.object({
      Id: z.string(),
      SandboxName: z.string(),
      LicenseType: z.string(),
      AutoActivate: z.boolean(),
      Description: z.string().nullable(),
    }),
  ),
});

export async function handler(event: unknown) {
  const refreshRequest = throwIfNotParsed('incoming event', sandboxRefreshRequestEventType.safeParse(event));

  const serviceUser = await getServiceUserInfo();
  const sfClient = await getSalesforceClientWithCustomCredentials({
    client_id: serviceUser.clientId,
    client_secret: serviceUser.clientSecret,
    username: serviceUser.username,
    password: serviceUser.password + serviceUser.secretToken,
  });

  const sandboxes = await list(sfClient);

  if (refreshRequest.action === 'list') {
    return sandboxes;
  } else {
    const sandboxToRefresh = sandboxes.records.find((s) => s.SandboxName === refreshRequest.sandboxName);
    if (!sandboxToRefresh) {
      throw new Error(`Sandbox with name ${refreshRequest.sandboxName} was not found.`);
    }

    if (sandboxToRefresh.LicenseType.toLowerCase() !== 'developer') {
      throw new Error(`Only developer sandboxes are allowed to be refreshed.`);
    }

    await refresh(sfClient, sandboxToRefresh.Id);

    return {};
  }
}

async function safeAxiosRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error: unknown) {
    const axiosError = error as AxiosError;
    if (axiosError.isAxiosError && axiosError.response) {
      if (axiosError.response) {
        throw new Error(
          `Error during external request '${axiosError.config?.method?.toUpperCase()} ${
            axiosError.config?.url
          }'. Response status code: ${axiosError.response.status}. Response body: '${JSON.stringify(
            axiosError.response.data,
          )}'.`,
        );
      } else if (axiosError.request) {
        throw new Error(
          `Error during external request '${axiosError.config?.method?.toUpperCase()} ${
            axiosError.config?.url
          }'. No response received.`,
        );
      } else {
        throw new Error(`Error during external request: '${axiosError.message}'`);
      }
    } else {
      throw error;
    }
  }
}

function throwIfNotParsed<I, O>(what: string, parseResult: SafeParseReturnType<I, O>) {
  if (parseResult.success) {
    return parseResult.data;
  }
  throw new Error(`Unexpected format when reading ${what}: ${parseResult.error.toString()}`);
}

async function list(sfClient: AxiosInstance) {
  const query = 'SELECT Id, SandboxName, LicenseType, AutoActivate, Description FROM SandboxInfo';
  const resp = await safeAxiosRequest(async () => {
    return await sfClient.get(
      `${env.SF_API_URL}/services/data/v${env.SF_API_VERSION}/tooling/query/?q=${query}`,
      getRequestConfig(),
    );
  });
  return throwIfNotParsed('list of sandboxes response', listDataType.safeParse(resp.data));
}

async function refresh(sfClient: AxiosInstance, id: string) {
  await safeAxiosRequest(async () => {
    await sfClient.patch(
      `${env.SF_API_URL}/services/data/v${env.SF_API_VERSION}/tooling/sobjects/SandboxInfo/${id}`,
      {
        LicenseType: 'DEVELOPER',
        AutoActivate: true,
        // SandboxManager
        ApexClassId: '01p2j000000fzgUAAQ',
      },
      getRequestConfig(),
    );
  });
}

function getRequestConfig() {
  return {
    headers: {
      'Accept-Encoding': 'gzip',
    },
  };
}

async function getServiceUserInfo() {
  const secrets = new AWS.SecretsManager({ region: env.AWS_REGION });
  const response = await secrets.getSecretValue({ SecretId: env.SECRETS_KEY }).promise();
  return throwIfNotParsed(
    'secret string',
    serviceUserInfoType.safeParse(JSON.parse(response.SecretString || '') as unknown),
  );
}
