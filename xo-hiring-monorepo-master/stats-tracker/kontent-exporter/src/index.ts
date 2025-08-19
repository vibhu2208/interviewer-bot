import axios from 'axios';
import AWS from 'aws-sdk';
import { EnvConfig, EnvConfigType, ProcessEnvType } from './env';

const processEnv = ProcessEnvType.parse(process.env);

type KontentItemType = {
  system: {
    id: string;
    codename: string;
    last_modified: string;
  };
};

function toAthenaTimeFormat(isoTimeFormat: string): string {
  return `timestamp '${isoTimeFormat.slice(0, 19).replace('T', ' ')}'`;
}
async function startQuery(athena: AWS.Athena, query: string, envConfig: EnvConfig): Promise<string> {
  const output = await athena
    .startQueryExecution({
      QueryString: query,
      QueryExecutionContext: { Catalog: 'AwsDataCatalog', Database: envConfig.athenaDb },
      ResultConfiguration: {
        OutputLocation: envConfig.athenaOutputLocation,
      },
    })
    .promise();
  const id = output.QueryExecutionId;
  if (id === undefined) {
    throw Error(`Unsuccessful startQueryExecution result: ${JSON.stringify(output.$response.error)}`);
  }
  return id;
}

async function waitForQueryResults(athena: AWS.Athena, queryExecutionId: string): Promise<string[][]> {
  // polling query results
  // eslint-disable-next-line no-constant-condition
  while (1) {
    // FAILED status may be retried by Athena for some errors, so
    // so in case of errors, we are letting this loop be terminated by lambda timeout
    const status = await athena.getQueryExecution({ QueryExecutionId: queryExecutionId }).promise();
    console.log(
      `QueryExecution:\n${JSON.stringify({
        ...status.QueryExecution,
        Query: status.QueryExecution?.Query?.substring(0, 50) + '...',
      })}`,
    );
    if (status.QueryExecution?.Status?.State === 'SUCCEEDED') {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const rows: string[][] = [];
  let columnTypes: string[] | undefined = undefined;
  let nextToken: string | undefined;
  // pagination
  // eslint-disable-next-line no-constant-condition
  while (1) {
    const queryResults = await athena
      .getQueryResults({ QueryExecutionId: queryExecutionId, NextToken: nextToken })
      .promise();

    const resultSet = queryResults?.ResultSet;

    if (!columnTypes) {
      columnTypes = resultSet?.ResultSetMetadata?.ColumnInfo?.map((ci) => ci.Type);
    }
    const rowList = resultSet?.Rows;

    if (rowList === undefined || columnTypes == undefined) {
      throw new Error(`Missing data. ${JSON.stringify(queryResults.$response.error)}`);
    }

    // first row is column names
    for (let i = 0; i < rowList.length; i++) {
      const rowData = rowList[i]?.Data;
      if (rowData === undefined) {
        throw new Error('Missing row data.');
      }
      rows.push(rowData.map((d) => d.VarCharValue || ''));
    }

    if (!queryResults.NextToken) {
      break;
    }

    nextToken = queryResults.NextToken;
  }

  if (!columnTypes) {
    throw new Error('Missing column types.');
  }

  console.log(`Skipping columns names: ${rows[0]?.join(' | ')}`);
  rows.shift();

  return rows;
}

async function getEnvConfig(secretKey: string): Promise<EnvConfig> {
  // fetch secret values
  const secretsClient = new AWS.SecretsManager({
    region: processEnv.AWS_REGION,
  });
  const result = await secretsClient.getSecretValue({ SecretId: secretKey }).promise();
  const secretString = result.SecretString;
  if (!secretString) {
    throw result.$response.error;
  }

  const parsedSecret = JSON.parse(secretString) as unknown;

  const envConfig = EnvConfigType.parse(parsedSecret);

  return envConfig;
}

export function escape(input: string) {
  return input.replace(/,/g, '\\,').replace(/'/g, "\\'");
}

export async function handler() {
  const envConfig = await getEnvConfig(processEnv.SECRETS_KEY);

  const athena = new AWS.Athena({ region: processEnv.AWS_REGION });

  const pipelineAthenaQueryExecutionId = await startQuery(
    athena,
    'select p.Id, p.Name, p.ProductCode, b.Name FROM Product2 p INNER JOIN Brand__c b ON p.Brand__c = b.Id',
    envConfig,
  );
  const pipelineAthenaQueryResults = await waitForQueryResults(athena, pipelineAthenaQueryExecutionId);
  const kontentResponse = await axios.get(
    `https://deliver.kontent.ai/${envConfig.kontentProjectId}/items/?system.type=pipeline&elements=system`,
    {
      headers: {
        Authorization: `Bearer ${envConfig.managementApiKey}`,
      },
      timeout: 30000,
    },
  );
  const items = kontentResponse?.data?.items;

  const itemsMap = new Map<string, KontentItemType>(
    items.map((item: KontentItemType) => {
      return [item.system.codename, item];
    }),
  );

  const insertValues: string[] = [];
  const missingPipelines: string[] = [];
  for (const pipeline of pipelineAthenaQueryResults) {
    const kontentItem: KontentItemType | undefined = itemsMap.get(`pipeline_${pipeline[2]}`);

    if (kontentItem !== undefined) {
      insertValues.push(
        "('" +
          pipeline[0] +
          "','" +
          kontentItem.system.id +
          "'," +
          toAthenaTimeFormat(kontentItem.system.last_modified) +
          ",'" +
          escape(pipeline[1]) +
          "','" +
          pipeline[2] +
          "','" +
          escape(pipeline[3]) +
          "')",
      );
    } else {
      console.error(`missing kontent metadata for pipeline_${pipeline[2]}`);
      missingPipelines.push(`pipeline_${pipeline[2]}`);
    }
  }

  if (insertValues.length > 0) {
    const dropKontentMetadataQueryExecutionId = await startQuery(
      athena,
      'DROP TABLE IF EXISTS kontent_metadata',
      envConfig,
    );
    await waitForQueryResults(athena, dropKontentMetadataQueryExecutionId);
    console.log('existing kontent_metadata table is dropped');

    const createKontentMetadataQueryExecutionId = await startQuery(
      athena,
      getCreateQuery(envConfig.athenaOutputLocation),
      envConfig,
    );
    await waitForQueryResults(athena, createKontentMetadataQueryExecutionId);
    console.log('kontent_metadata table is created');

    const insertQuery =
      'INSERT INTO kontent_metadata (pipeline_id, kontent_item_id, kontent_last_modified, pipeline_name, pipeline_code, pipeline_brand) VALUES ' +
      insertValues.join(',');
    const insertKontentMetadataQueryExecutionId = await startQuery(athena, insertQuery, envConfig);
    await waitForQueryResults(athena, insertKontentMetadataQueryExecutionId);
  }
  if (missingPipelines.length > 0) {
    console.error(
      `kontent_metadata table was created! However there were pipelines with missing metadata:\n ${missingPipelines.join(
        '\n',
      )}`,
    );
  }
}

function getCreateQuery(s3Location: string) {
  return `CREATE External TABLE kontent_metadata (
    pipeline_id STRING,
    kontent_item_id STRING,
    kontent_last_modified TIMESTAMP,
    pipeline_name STRING,
    pipeline_code STRING,
    pipeline_brand STRING
)  LOCATION '${s3Location + Date.now()}/'`;
}

if (processEnv.INVOKE_HANDLER) {
  handler();
}
