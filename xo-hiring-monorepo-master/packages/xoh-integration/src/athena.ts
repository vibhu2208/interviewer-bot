import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  GetQueryResultsCommandOutput,
  StartQueryExecutionCommand,
  QueryExecutionStatus,
  Row,
} from '@aws-sdk/client-athena';
import { getStableEnvironmentName } from './environment';

const client = new AthenaClient();
const QueryRunningStates = ['QUEUED', 'RUNNING'];
const QuerySuccessState = 'SUCCEEDED';
const WaitingMilliSeconds = 1000;

export interface QueryExecutionOptions {
  parameters?: string[];
  database?: string;
  outputBucket?: string;
}

export class Athena {
  /**
   * Get the default query output bucket.
   */
  static getDefaultQueryOutputBucket() {
    return `s3://xo-${getStableEnvironmentName()}-athena-query-results/xoc-integration/`;
  }

  /***
   * Execute Athena query and wait for the result.
   * @param query Athena query.
   * @param [options] Additional query options.
   */
  static async query<T>(query: string, options?: QueryExecutionOptions): Promise<T[]> {
    const queryExecutionId = await Athena.startQueryExecution(query, options);
    if (queryExecutionId == null) {
      throw new Error(`Cannot start query execution`);
    }

    let queryStatus: QueryExecutionStatus | null = null;
    do {
      await Athena.waitFor(WaitingMilliSeconds);
      queryStatus = await Athena.getQueryExecutionStatus(queryExecutionId);
    } while (queryStatus != null && QueryRunningStates.includes(queryStatus.State ?? ''));

    if (queryStatus?.State !== QuerySuccessState) {
      throw new Error(`Query execution failed with error: ${queryStatus?.StateChangeReason}`);
    }

    return await Athena.getQueryExecutionResults<T>(queryExecutionId);
  }

  /**
   * Start Athena query execution.
   * @param query Athena query.
   * @param [options] Additional query options.
   */
  static async startQueryExecution(query: string, options?: QueryExecutionOptions): Promise<string | null> {
    const response = await client.send(
      new StartQueryExecutionCommand({
        QueryString: query,
        ExecutionParameters: options?.parameters,
        ResultConfiguration: {
          OutputLocation: options?.outputBucket ?? Athena.getDefaultQueryOutputBucket(),
        },
        QueryExecutionContext: {
          Database: options?.database ?? 'default',
        },
      }),
    );
    return response.QueryExecutionId ?? null;
  }

  static async getQueryExecutionStatus(queryExecutionId: string): Promise<QueryExecutionStatus | null> {
    const response = await client.send(
      new GetQueryExecutionCommand({
        QueryExecutionId: queryExecutionId,
      }),
    );
    return response.QueryExecution?.Status ?? null;
  }

  static async getQueryExecutionResults<T>(queryExecutionId: string, maxResults?: number): Promise<T[]> {
    const rows: Row[] = [];
    let nextToken: string | undefined = undefined;
    do {
      const queryResultResponse: GetQueryResultsCommandOutput = await client.send(
        new GetQueryResultsCommand({
          QueryExecutionId: queryExecutionId,
          MaxResults: maxResults,
          NextToken: nextToken,
        }),
      );
      nextToken = queryResultResponse?.NextToken;
      if (queryResultResponse.ResultSet?.Rows) {
        queryResultResponse.ResultSet?.Rows.forEach((row) => {
          rows.push(row);
        });
      }
    } while (nextToken != null);

    // Nothing to return
    if (rows.length === 0) {
      return [];
    }

    // First row is the field names of the output columns
    const fieldNames = rows.shift()?.Data?.map((field) => field.VarCharValue ?? '') ?? [];
    const output: T[] = [];
    for (const row of rows) {
      const object: Record<string, unknown> = {};
      row.Data?.forEach((field, index) => {
        object[fieldNames[index]] = field.VarCharValue;
      });
      output.push(object as T);
    }
    return output;
  }

  static waitFor(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
