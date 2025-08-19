import axios, { AxiosInstance } from 'axios';
import { OrderAssessmentRequest, OrderAssessmentResponse } from './types';
import {
  Session,
  AttemptAnswerMutation,
  AttemptAnswerMutationVariables,
  AnswerAttemptedSubscriptionVariables,
  AnswerAttemptedSubscription,
} from './graphql/api';
import { getSessionById } from './graphql/queries';
import { attemptAnswer, markSessionAsCompleted } from './graphql/mutations';
import { answerAttempted } from './graphql/subscriptions';

import AWSAppSyncClient, { AUTH_TYPE } from 'aws-appsync';
import fetch from 'cross-fetch';
import WebSocket from 'ws';
import gql from 'graphql-tag';
import { Observable } from 'rxjs';

global.fetch = fetch;
(global as any).WebSocket = WebSocket;

export class InterviewBotClient {
  private readonly httpClient: AxiosInstance;
  private readonly gqlClient: AWSAppSyncClient<any>;

  constructor(baseURL: string, gqlApiUrl: string, gqlApiKey: string) {
    this.httpClient = axios.create({
      baseURL,
    });

    this.gqlClient = new AWSAppSyncClient({
      url: gqlApiUrl,
      region: 'us-east-1', // Adjust to your actual region
      auth: {
        type: AUTH_TYPE.API_KEY,
        apiKey: gqlApiKey,
      },
      disableOffline: true,
    });
  }

  public async orderAssessment(request: OrderAssessmentRequest): Promise<OrderAssessmentResponse> {
    try {
      const response = await this.httpClient.post<OrderAssessmentResponse>('/assessment/order', request);
      return response.data;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`Failed to order assessment: ${error.response.status} ${JSON.stringify(error.response.data)}`);
      } else if (error instanceof Error) {
        throw new Error(`An unexpected error occurred: ${error.message}`);
      } else {
        throw new Error('An unexpected error occurred of an unknown type.');
      }
    }
  }

  public async markSessionCompleted(sessionId: string) {
    await this.gqlClient.mutate({
      mutation: gql(markSessionAsCompleted),
      variables: { sessionId },
    });
  }

  public async getSession(sessionId: string, secretKey?: string): Promise<Session> {
    const result = await this.gqlClient.query<{ getSessionById: Session }>({
      query: gql(getSessionById),
      variables: { sessionId, secretKey: secretKey ?? undefined },
      fetchPolicy: 'network-only',
    });

    return result.data.getSessionById;
  }

  public async attemptAnswer(
    variables: AttemptAnswerMutationVariables,
  ): Promise<AttemptAnswerMutation['attemptAnswer']> {
    const { data } = await this.gqlClient.mutate<AttemptAnswerMutation>({
      mutation: gql(attemptAnswer),
      variables,
    });
    if (!data) {
      throw new Error('No data returned from attemptAnswer mutation');
    }
    return data.attemptAnswer;
  }

  private subscribeToAnswerAttempts(
    variables: AnswerAttemptedSubscriptionVariables,
    onData: (data: AnswerAttemptedSubscription['answerAttempted']) => void,
    onError: (error: any) => void,
  ) {
    console.log('Attempting to subscribe with variables:', JSON.stringify(variables));
    const observable = this.gqlClient.subscribe<{ data: AnswerAttemptedSubscription }>({
      query: gql(answerAttempted),
      variables,
    });

    const subscription = observable.subscribe({
      next: ({ data }) => {
        onData(data.answerAttempted);
      },
      error: (error) => {
        console.error('Subscription threw an error:', JSON.stringify(error, null, 2));
        onError(error);
      },
      complete: () => {
        console.log('Subscription completed.');
      },
    });

    return {
      unsubscribe: () => subscription.unsubscribe(),
    };
  }

  public subscribeToAnswerAttemptsObservable(variables: {
    sessionId: string;
    questionId: string;
  }): Observable<AnswerAttemptedSubscription['answerAttempted']> {
    return new Observable((subscriber) => {
      const sub = this.subscribeToAnswerAttempts(
        variables,
        (data) => subscriber.next(data),
        (error) => subscriber.error(error),
      );
      return () => sub.unsubscribe();
    });
  }
}
