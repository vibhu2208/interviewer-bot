import AWS from 'aws-sdk';
import { EnvConfig, EnvConfigType, ProcessEnvType } from './env';
import { getOpportunitiesQuery } from './get-opportunities-query';
import { renderSheet } from './render-sheet';

const processEnv = ProcessEnvType.parse(process.env);

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

type QueryResults = {
  rows: string[][];
  /**
   * See https://docs.aws.amazon.com/athena/latest/ug/data-types.html
   */
  columnTypes: string[];
};

async function waitForQueryResults(athena: AWS.Athena, queryExecutionId: string): Promise<QueryResults> {
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
        throw new Error('Missing row data');
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

  return {
    rows,
    columnTypes,
  };
}

async function getEnvConfig(): Promise<EnvConfig> {
  // fetch secret values
  const secretsClient = new AWS.SecretsManager({
    region: processEnv.AWS_REGION,
  });
  const result = await secretsClient.getSecretValue({ SecretId: processEnv.SECRETS_KEY }).promise();
  const secretString = result.SecretString;
  if (!secretString) {
    throw result.$response.error;
  }

  const parsedSecret = JSON.parse(secretString) as unknown;

  const envConfig = EnvConfigType.parse(parsedSecret);

  return envConfig;
}

export async function handler() {
  const envConfig = await getEnvConfig();

  const athena = new AWS.Athena({ region: processEnv.AWS_REGION });

  const mainQueryExecutionId =
    envConfig.athenaExecutionId ?? (await startQuery(athena, getOpportunitiesQuery(), envConfig));

  const mainQueryResults = await waitForQueryResults(athena, mainQueryExecutionId);

  console.log(`MAIN QUERY: ${mainQueryResults.rows.length} rows`);

  const dropTableQuery = 'DROP TABLE IF EXISTS e2e_tracker';
  const dropTableExecutionId = await startQuery(athena, dropTableQuery, envConfig);
  await waitForQueryResults(athena, dropTableExecutionId);

  const createTableQuery = 'CREATE TABLE e2e_tracker AS ' + getOpportunitiesQuery();
  const createTableExecutionId = await startQuery(athena, createTableQuery, envConfig);
  await waitForQueryResults(athena, createTableExecutionId);

  const dateQueryExecutionId = await startQuery(
    athena,
    'SELECT MAX(LastModifiedDate) AS COLNAME FROM Application_Step_Result__c',
    envConfig,
  );
  const dateQueryResults = await waitForQueryResults(athena, dateQueryExecutionId);
  const effectiveDate = new Date(Date.parse(dateQueryResults.rows[0][0]));
  const effectiveDateStr = effectiveDate.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  // publish to GoogleSheet
  await renderSheet(envConfig, processEnv, {
    ...mainQueryResults,
    title: `${processEnv.TARGET_TITLE_PREFIX}Crossover End-to-End Conversion Tracker, data up to ${effectiveDateStr}`,
  });
}

if (processEnv.INVOKE_HANDLER) {
  handler();
}
