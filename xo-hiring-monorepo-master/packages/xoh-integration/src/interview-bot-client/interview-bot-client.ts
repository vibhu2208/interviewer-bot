import axios, { AxiosInstance } from 'axios';
import {
  FetchInterviewConversationsRequest,
  FetchInterviewConversationsResponse,
  InterviewConversation,
} from './types';

export class InterviewBotClient {
  private readonly httpClient: AxiosInstance;

  constructor(baseURL: string) {
    this.httpClient = axios.create({
      baseURL,
    });
  }

  public async fetchInterviewConversations(
    request: FetchInterviewConversationsRequest,
  ): Promise<InterviewConversation[]> {
    try {
      const response = await this.httpClient.post<FetchInterviewConversationsResponse>(
        '/interview-conversations',
        request,
      );
      return response.data.interviewConversations;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`An unexpected error occurred: ${error.message}`);
      } else {
        throw new Error('An unexpected error occurred of an unknown type.');
      }
    }
  }
}
