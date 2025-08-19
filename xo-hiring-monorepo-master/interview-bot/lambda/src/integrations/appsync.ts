import { fromEnv, fromIni, fromNodeProviderChain, fromProcess } from '@aws-sdk/credential-providers';
import { AWSAppSyncClient } from 'aws-appsync';
import gql from 'graphql-tag';
import { Config } from '../config';

let graphqlClient: AWSAppSyncClient<any> | null = null;

export class AppSync {
  static async getClient(): Promise<AWSAppSyncClient<any>> {
    if (graphqlClient != null) {
      return graphqlClient;
    }

    graphqlClient = new AWSAppSyncClient({
      url: Config.getAppSyncEndpointUrl(),
      region: Config.getRegion(),
      auth: {
        type: 'AWS_IAM',
        credentials: fromNodeProviderChain({
          ...fromEnv(),
          ...fromProcess(),
          ...fromIni(),
        }),
      },
      disableOffline: true,
    });

    return graphqlClient;
  }

  /**
   * Trigger AppSync subscription "answerAttempted"
   */
  static async triggerAnswerAttempted(data: AnswerAttemptResult): Promise<void> {
    const client = await AppSync.getClient();
    // It is crucial to request fields that will be used for filtering on the frontend (sessionId, questionId)
    // Otherwise filtering will not work
    const mutation = gql`
      mutation Trigger($data: AnswerAttemptInput!) {
        triggerAnswerAttempted(data: $data) {
          error
          result
          attempts
          sessionId
          questionId
          state
          validAnswer
        }
      }
    `;
    await client.mutate({
      mutation,
      variables: {
        data,
      },
    });
  }
}

export interface AnswerAttemptResult {
  /**
   * Required for the subscription filtering
   */
  sessionId: string;
  /**
   * Required for the subscription filtering
   */
  questionId: string;
  /**
   * Null if success
   */
  error?: string | null;
  result?: string;
  attempts?: number;
  /**
   * Question state (if the question have one). Currently only used to indicate the end of the interview
   */
  state?: 'Completed' | null;
  /**
   * False if the answer is not valid (i.e. cheating detected)
   */
  validAnswer?: boolean;
}
