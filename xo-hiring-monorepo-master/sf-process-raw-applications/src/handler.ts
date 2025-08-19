import AWS from 'aws-sdk';
import { AxiosInstance } from 'axios';
import { z } from 'zod';
import { Context } from 'aws-lambda/handler';
import { getSalesforceClientWithCustomCredentials } from '@trilogy-group/xo-hiring-integration';

const applicationRawType = z.object({ Id: z.string() }).passthrough();
type ApplicationRaw = z.infer<typeof applicationRawType>;

const queryHeaderDataType = z.object({
  totalSize: z.number(),
  done: z.literal(true),
});

const rawAppsDataType = queryHeaderDataType.and(
  z.object({
    records: z.array(applicationRawType),
  }),
);

const configType = z
  .object({
    sfEndpoint: z.string(),
    workerNum: z.number().int().positive().lte(500).default(1),
    appsPerWorker: z
      .number()
      .int()
      .positive()
      .lte(3, 'Processing more then 3 applications in one batch is not possible due to SOQL limit.')
      .default(1),
  })
  .passthrough();

const authConfigType = z
  .object({
    authEndpoint: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    username: z.string(),
    password: z.string(),
    securityToken: z.string(),
  })
  .passthrough();

type Config = z.infer<typeof configType>;

type AuthConfig = z.infer<typeof authConfigType>;

async function readConfig<T>(
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

async function runProcessing(config: Config, sfClient: AxiosInstance, workerId: number, apps: ApplicationRaw[]) {
  console.log(`Worker#${workerId} has started. ${apps.map((a) => a.Id).join(', ')}`);
  try {
    const resp = await sfClient.post(
      `${config.sfEndpoint}/services/data/v54.0/actions/custom/apex/ProcessRawApplicationsService`,
      {
        inputs: apps.map((a) => ({
          applicationRawId: a.Id,
        })),
      },
      {
        headers: {
          'content-type': 'application/json',
        },
      },
    );
    console.log(`Worker#${workerId} has completed. ${resp.status}`);
    return true;
  } catch (error) {
    console.log(`Worker#${workerId} faced error.`);
    console.error(error);
    return false;
  }
}

async function runProcessingIteration(config: Config, sfClient: AxiosInstance): Promise<boolean> {
  // query all work
  const query = `SELECT max(Id) Id, Candidate_Email__c, min(CreatedDate) FROM Application_Raw__c
WHERE IsProcessed__c=FALSE
GROUP BY Candidate_Email__c
ORDER BY min(CreatedDate)
LIMIT ${config.workerNum * config.appsPerWorker}`;

  const rawAppsAxiosResponse = await sfClient.get(
    `${config.sfEndpoint}/services/data/v54.0/query/?q=${encodeURIComponent(query)}`,
  );

  const rawAppsData = rawAppsDataType.parse(rawAppsAxiosResponse.data as unknown);
  if (rawAppsData.totalSize == 0) {
    console.log('Skipping the run, no data.');
    return true;
  }

  // distribute the work
  const runs: Promise<boolean>[] = [];
  for (let i = 0; i < config.workerNum; i++) {
    const workerRecords = rawAppsData.records.slice(config.appsPerWorker * i, config.appsPerWorker * (i + 1));
    if (workerRecords.length === 0) break;
    runs.push(runProcessing(config, sfClient, i, workerRecords));
  }

  // wait for completion
  console.log(`Waiting for completion of ${runs.length} workers.`);

  const executionResult = await Promise.all(runs);
  return rawAppsData.totalSize != config.workerNum * config.appsPerWorker && !executionResult.includes(false);
}

export async function handler(event: unknown, context: Context) {
  if (!process.env.SSM_PARAMETER_PREFIX || !process.env.SSM_PARAMETER_SERVICE_ACCOUNT) {
    throw new Error('Required env vars are missing: SSM_PARAMETER_PREFIX, SSM_PARAMETER_SERVICE_ACCOUNT');
  }

  const config: Config = await readConfig(
    process.env.SSM_PARAMETER_PREFIX.split(',').map((prefix) => `${prefix}/config`),
    false,
    configType,
  );

  const authConfig: AuthConfig = await readConfig(
    process.env.SSM_PARAMETER_SERVICE_ACCOUNT.split(','),
    true,
    authConfigType,
  );

  const sfClient = await getSalesforceClientWithCustomCredentials({
    client_id: authConfig.clientId,
    client_secret: authConfig.clientSecret,
    username: authConfig.username,
    password: authConfig.password + authConfig.securityToken,
  });

  let completedWork;
  do {
    completedWork = await runProcessingIteration(config, sfClient);
    if (completedWork) {
      break;
    }
    // avoid timeouts by exiting one minute before it.
  } while (context.getRemainingTimeInMillis() / 1000 > 60);

  if (!completedWork) {
    throw new Error('work remaining and time out is close');
  }
}
