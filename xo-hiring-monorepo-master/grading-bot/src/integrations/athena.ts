import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryExecutionCommandOutput,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  GetQueryResultsCommandOutput,
  Row,
} from '@aws-sdk/client-athena';
import { Logger } from '../common/logger';
import { waitFor } from '../common/util';
import { Config } from '../config';

const log = Logger.create('athena');

const client = new AthenaClient({ region: Config.getRegion() });
const queryRunningStates = ['QUEUED', 'RUNNING'];
const querySuccessState = 'SUCCEEDED';
const waitingMilliSeconds = 1000;

/***
 * Class used to execute Athena SDK methods.
 */
export class Athena {
  /**
   * Just run an athena query and return the result
   */
  static async query<T>(query: string): Promise<T[]> {
    const queryExecutionId = await Athena.startQueryExecution(query);
    if (queryExecutionId == null) {
      throw new Error(`Cannot start query execution of the Athena query: execution id is null`);
    }
    const success = await Athena.waitForQueryExecution(queryExecutionId);
    if (!success) {
      throw new Error(`Athena query execution is not successful`);
    }

    const rows: Row[] = [];
    let result: GetQueryResultsCommandOutput | undefined;
    do {
      result = await Athena.getQueryResults(queryExecutionId, result?.NextToken);
      result.ResultSet?.Rows?.forEach((it) => rows.push(it));
      log.debug(`Fetched ${result.ResultSet?.Rows?.length} rows for ${queryExecutionId}`);
    } while (result?.NextToken != null);

    return Athena.transformRows<T>(rows);
  }

  /**
   * Start a new query execution
   * @return query execution id
   */
  static async startQueryExecution(query: string): Promise<string | null> {
    const athenaQuery = await client.send(
      new StartQueryExecutionCommand({
        ResultConfiguration: {
          OutputLocation: 's3://' + Config.getAthenaOutputLocation(),
        },
        QueryString: query,
        QueryExecutionContext: {
          Database: Config.getAthenaDb(),
        },
      }),
    );
    const queryExecutionId = athenaQuery.QueryExecutionId ?? null;
    log.plain(`ATHENA_QueryExecutionId: ${queryExecutionId}`);
    return queryExecutionId;
  }

  /***
   * Wait for the query to be executed
   * @return true if execution successful, otherwise false
   */
  static async waitForQueryExecution(queryExecutionId: string): Promise<boolean> {
    let executionFinished = false;
    let getResult: GetQueryExecutionCommandOutput | undefined = undefined;
    while (!executionFinished) {
      getResult = await client.send(
        new GetQueryExecutionCommand({
          QueryExecutionId: queryExecutionId,
        }),
      );
      executionFinished = !queryRunningStates.includes(String(getResult.QueryExecution?.Status?.State));
      await waitFor(waitingMilliSeconds);
    }

    if (getResult?.QueryExecution?.Status?.AthenaError != null) {
      throw new Error(`Athena error: ${getResult.QueryExecution.Status.AthenaError.ErrorMessage}`);
    }

    return getResult?.QueryExecution?.Status?.State === querySuccessState;
  }

  /**
   * Get query results
   * @param queryExecutionId
   * @param nextToken
   * @param maxResults
   */
  static async getQueryResults(
    queryExecutionId: string,
    nextToken?: string,
    maxResults?: number,
  ): Promise<GetQueryResultsCommandOutput> {
    return await client.send(
      new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
        NextToken: nextToken,
        MaxResults: maxResults,
      }),
    );
  }

  /**
   * Transform Athena result set rows into a proper JS data structure
   * @param rows
   * @return JS objects array. Column names are object field names
   */
  static transformRows<T>(rows: Row[]): T[] {
    // The first row contains column names and do not have output
    if (rows.length <= 1) {
      return [];
    }

    // Transform rows into a proper json objects
    const output = [];
    const fieldNames = rows[0].Data?.map((it) => it.VarCharValue) as string[];
    for (let i = 1; i < rows.length; i++) {
      const obj: any = {};
      for (let j = 0; j < fieldNames.length; j++) {
        obj[fieldNames[j]] = rows[i].Data?.[j].VarCharValue;
      }
      output.push(obj);
    }

    return output;
  }
}
