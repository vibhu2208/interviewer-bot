import { Athena } from 'aws-sdk';
import { GetQueryExecutionOutput, GetQueryResultsOutput, QueryExecutionId, Token } from 'aws-sdk/clients/athena';
import { CommonUtil } from './common-util';

const athena = new Athena({ region: process.env.AWS_REGION });
const queryRunningStates = ['QUEUED', 'RUNNING'];
const querySuccessState = 'SUCCEEDED';
const waitingMilliSeconds = 1000;

/***
 * Class used to execute Athena SDK methods.
 */
export const AthenaUtil = {
  startQueryExecution: async (query: string): Promise<QueryExecutionId> => {
    const athenaQuery = await athena
      .startQueryExecution({
        ResultConfiguration: {
          OutputLocation: process.env.ATHENA_OUTPUT_LOCATION,
        },
        QueryString: query,
        QueryExecutionContext: {
          Database: process.env.ATHENA_DB,
        },
      })
      .promise();
    const queryExecutionId = athenaQuery.QueryExecutionId ?? '';
    console.log(`queryExecutionId: ${queryExecutionId}`);
    return queryExecutionId;
  },

  /***
   * Execute Athena query and wait for the result.
   * @param queryExecutionId Athena query to be executed.
   * returns query result if execution is successful. Return undefined if failed.
   */
  executeQuery: async (queryExecutionId: QueryExecutionId): Promise<boolean> => {
    let executionFinished = false;
    let getResult: GetQueryExecutionOutput | undefined = undefined;
    while (!executionFinished) {
      getResult = await athena
        .getQueryExecution({
          QueryExecutionId: queryExecutionId,
        })
        .promise();
      executionFinished = !queryRunningStates.includes(String(getResult.QueryExecution?.Status?.State));
      await CommonUtil.waitFor(waitingMilliSeconds);
    }

    return getResult?.QueryExecution?.Status?.State === querySuccessState;
  },

  getQueryResults: async (
    queryExecutionId: QueryExecutionId,
    nextToken?: Token,
    maxResults?: number,
  ): Promise<GetQueryResultsOutput> => {
    return await athena
      .getQueryResults({
        QueryExecutionId: queryExecutionId,
        NextToken: nextToken,
        MaxResults: maxResults,
      })
      .promise();
  },
};
