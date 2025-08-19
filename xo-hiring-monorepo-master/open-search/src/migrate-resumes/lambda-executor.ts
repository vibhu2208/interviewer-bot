import { EARLY_EXIT_THRESHOLD } from '../common/constants';
import { GetQueryResultsOutput, Row, RowList } from 'aws-sdk/clients/athena';
import { AthenaUtil } from '../common/athena-util';
import { AxiosInstance } from 'axios';
import { Context } from 'aws-lambda';
import { OpenSearchConfig } from '../common/configs';
import { migrate } from './helper';

const QUERY_USING_INTERVAL = `
SELECT acc.Id candidateId
FROM account acc
LEFT JOIN args ON true
WHERE acc.hasresume__c = true
AND from_iso8601_timestamp(acc.createddate) >= args.startDate
AND from_iso8601_timestamp(acc.createddate) < args.endDate
`;

const QUERY_USING_ID = `
SELECT acc.Id candidateId
FROM account acc
LEFT JOIN args ON true
WHERE acc.hasresume__c = true
AND acc.Id IN (args.ids)
`;

const queries = [QUERY_USING_INTERVAL, QUERY_USING_ID];

export interface MigrateResumesLambdaEvent {
  queryIndex?: number;
  migrateResumeStartDate?: string;
  migrateResumeEndDate?: string;
  ids?: string;
  fetched?: number;
  headerRow?: (string | undefined)[];
  queryExecutionId?: string;
  nextToken?: string;
}

interface MigrateResumesLambdaContext {
  event: MigrateResumesLambdaEvent;
  context: Context;
  config: OpenSearchConfig;
  sfClient: AxiosInstance;
}

export class LambdaExecutor {
  readonly ctx: MigrateResumesLambdaContext;

  constructor(ctx: MigrateResumesLambdaContext) {
    this.ctx = ctx;
  }

  async run(): Promise<MigrateResumesLambdaEvent> {
    if (!process.env.RESUMES_BUCKET) {
      throw new Error('Required env vars are missing: RESUMES_BUCKET');
    }
    const bucketName = process.env.RESUMES_BUCKET;

    const event = this.ctx.event;
    event.queryIndex = event.queryIndex ?? 0;
    if (event.queryIndex < 0 || event.queryIndex > 1) {
      throw new Error('Invalid queryIndex parameter');
    }
    if (
      event.queryIndex == 0 &&
      (event.migrateResumeStartDate === undefined || event.migrateResumeEndDate === undefined)
    ) {
      throw new Error('Required parameters are missing: migrateResumeStartDate, migrateResumeEndDate');
    }
    if (event.queryIndex == 1 && event.ids === undefined) {
      throw new Error('Required parameters are missing: ids');
    }
    console.log(`Fetching data between ${event.migrateResumeStartDate} and ${event.migrateResumeEndDate}`);

    const dataRows = await this.fetchDataFromLambda(event, async (rows: object[]) => {
      await migrate(bucketName, rows, this.ctx.sfClient);
    });

    console.log(`Athena query result: ${dataRows.length} fetched`);
    return Promise.resolve(event);
  }

  private async fetchDataFromLambda(
    event: MigrateResumesLambdaEvent,
    // eslint-disable-next-line @typescript-eslint/ban-types
    handler: Function,
  ): Promise<object[]> {
    console.log('Executing Athena query');
    const queryArguments = [
      `
      WITH args AS (
        SELECT date('${event.migrateResumeStartDate}') AS startDate,
               date('${event.migrateResumeEndDate}') AS endDate
        )
      `,
      `
      WITH args AS (
        SELECT ${event.ids} AS ids
        )
      `,
    ];
    let queryExecutionId;
    if (event.queryExecutionId) {
      console.log(`Re-use passed queryExecutionId: ${event.queryExecutionId}; nextToken: ${event.nextToken}`);
      queryExecutionId = event.queryExecutionId;
    } else {
      console.log(`Starting new query execution`);
      queryExecutionId = await AthenaUtil.startQueryExecution(
        `${queryArguments[event.queryIndex ?? 0]}${queries[event.queryIndex ?? 0]}`,
      );

      const success = await AthenaUtil.executeQuery(queryExecutionId);
      if (success) {
        console.log('Athena query executed successfully');
      } else {
        console.warn('Failed to execute Athena query');
        return [];
      }
    }

    event.queryExecutionId = queryExecutionId;

    const rows: RowList = [];
    let nextToken = event.nextToken;
    let process = true;
    while (process) {
      console.log(`Fetching data from Athena;${nextToken ? ' nextToken: ' + nextToken : ''}`);
      const queryResults: GetQueryResultsOutput = await AthenaUtil.getQueryResults(queryExecutionId, nextToken, 20);
      const resultRows = queryResults?.ResultSet?.Rows ?? [];

      console.log(`Fetched ${resultRows.length} from Athena in a chunk`);
      // first row is with column names, so start with -1
      event.fetched = event.fetched ?? -1;
      event.fetched += resultRows.length;

      if (resultRows.length != 0) {
        if (event.headerRow === undefined) {
          event.headerRow = resultRows.shift()?.Data?.map((row) => row.VarCharValue) ?? [];
        }

        const documents = resultRows.map((row) => this.convertRow(row));
        await handler(documents);

        rows.push(...documents);
      }

      nextToken = queryResults?.NextToken;
      event.nextToken = nextToken;
      if (!nextToken) {
        process = false;
        console.log('Break the loop');
      } else if (this.ctx.context.getRemainingTimeInMillis() < 3 * EARLY_EXIT_THRESHOLD) {
        process = false;
        console.log('Remaining time is too low, returning early');
      } else {
        console.log('Continue to the next data block');
      }
    }

    console.log(`Fetched totally ${rows.length} rows from Athena`);
    return rows;
  }

  private convertRow(row: Row): object {
    const { Data } = row;
    return {
      [`${this.ctx.event.headerRow?.[0]}`]: Data?.[0].VarCharValue, // candidateId
    };
  }
}
