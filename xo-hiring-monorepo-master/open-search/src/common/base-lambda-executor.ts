import { Context } from 'aws-lambda';
import { GetQueryResultsOutput, Row, RowList } from 'aws-sdk/clients/athena';
import { AthenaUtil } from './athena-util';
import { OpenSearchConfig } from './configs';
import {
  COMPENSATION_THRESHOLD,
  DEFAULT_DATE_DIFF,
  DEFAULT_START_DATE,
  EARLY_EXIT_THRESHOLD,
  HIRED_THRESHOLD_MONTHS,
} from './constants';
import { search, vectorSearch } from './index-mappings';
import { OpenSearchClient } from './open-search-util';
import { SqsUtils } from './sqs-utils';
import { VectorSearchClient } from './vector-search-util';

export interface LambdaEvent {
  startDate?: string;
  fetched?: number;
  indexed?: number;
  headerRow?: (string | undefined)[];
  queryExecutionId?: string;
  nextToken?: string;
}

export interface LambdaContext {
  event: LambdaEvent;
  context: Context;
  config: OpenSearchConfig;
}

export abstract class BaseLambdaExecutor {
  readonly ctx: LambdaContext;
  readonly query: string;
  readonly resumeIndexSqsUtils: SqsUtils;
  readonly bfqIndexSqsUtils: SqsUtils;

  protected constructor(ctx: LambdaContext, query: string) {
    this.ctx = ctx;
    this.query = query;

    if (!process.env.RESUME_INDEX_QUEUE_URL) {
      throw new Error('Required env vars are missing: RESUME_INDEX_QUEUE_URL');
    }
    this.resumeIndexSqsUtils = new SqsUtils(process.env.RESUME_INDEX_QUEUE_URL);

    if (!process.env.BFQS_INDEX_QUEUE_URL) {
      throw new Error('Required env vars are missing: BFQS_INDEX_QUEUE_URL');
    }
    this.bfqIndexSqsUtils = new SqsUtils(process.env.BFQS_INDEX_QUEUE_URL);
  }

  async run(): Promise<LambdaEvent> {
    if (!process.env.COLLECTION_ENDPOINT) {
      throw new Error('Required env vars are missing: COLLECTION_ENDPOINT');
    }
    if (!process.env.VECTOR_SEARCH_COLLECTION_ENDPOINT) {
      throw new Error('Required env vars are missing: VECTOR_SEARCH_COLLECTION_ENDPOINT');
    }

    const event = this.ctx.event;

    const aliasName: string = this.ctx.config.aliasName;
    const client = new OpenSearchClient(this.ctx.config.serviceName, process.env.COLLECTION_ENDPOINT);
    await client.initializeAlias(aliasName, search);

    // Ensure vector search index exists
    const vectorSearchClient = new VectorSearchClient(
      this.ctx.config.serviceName,
      process.env.VECTOR_SEARCH_COLLECTION_ENDPOINT,
    );
    await vectorSearchClient.initializeAlias(aliasName, vectorSearch);

    const startDate = this.getStartDate(event);
    console.log(`Fetching data starting with ${startDate}`);

    const dataRows = await this.fetchDataFromLambda(startDate, event, async (rows: object[]) => {
      if (rows.length === 0) {
        console.log(`Zero rows to add, skip`);
        return;
      }
      const { indexedCount, created } = await client.addDocuments(aliasName, rows);

      // Index documents with metadata only
      await vectorSearchClient.indexDocuments(aliasName, rows as any, false);

      event.indexed = event.indexed ?? 0;
      event.indexed += indexedCount;
      if (created.length > 0) {
        await this.resumeIndexSqsUtils.sendMessages(created);
        await this.bfqIndexSqsUtils.sendMessages(created);
      }
    });
    console.log(`Athena query result: ${dataRows.length} fetched`);
    return Promise.resolve(event);
  }

  private async fetchDataFromLambda(
    startDate: string,
    event: LambdaEvent,
    // eslint-disable-next-line @typescript-eslint/ban-types
    handler: Function,
  ): Promise<object[]> {
    console.log('Executing Athena query');
    const queryArguments = `
      WITH args AS (
        SELECT ${COMPENSATION_THRESHOLD} AS compensationThreshold,
               ${HIRED_THRESHOLD_MONTHS} AS hiredThresholdMonths,
               date('${startDate}') AS startDate
        ),
    `;
    let queryExecutionId;
    if (event.queryExecutionId) {
      console.log(`Re-use passed queryExecutionId: ${event.queryExecutionId}; nextToken: ${event.nextToken}`);
      queryExecutionId = event.queryExecutionId;
    } else {
      console.log(`Starting new query execution`);
      queryExecutionId = await AthenaUtil.startQueryExecution(`${queryArguments}${this.query}`);

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
      const queryResults: GetQueryResultsOutput = await AthenaUtil.getQueryResults(queryExecutionId, nextToken);
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
      } else if (this.ctx.context.getRemainingTimeInMillis() < EARLY_EXIT_THRESHOLD) {
        process = false;
        console.log('Remaining time is too low, returning early');
      } else {
        console.log('Continue to the next data block');
      }
    }

    console.log(`Fetched totally ${rows.length} rows from Athena`);
    return rows;
  }

  private getStartDate(event: LambdaEvent): string {
    let startDate = event.startDate ?? DEFAULT_START_DATE;
    const dateDiff = this.ctx.config.dateDiff ?? DEFAULT_DATE_DIFF;
    if (dateDiff >= 0) {
      const d = new Date();
      d.setDate(d.getDate() - dateDiff);
      startDate = d.toISOString().split('T')[0];
    }
    return startDate;
  }

  protected abstract convertRow(row: Row): object;
}
