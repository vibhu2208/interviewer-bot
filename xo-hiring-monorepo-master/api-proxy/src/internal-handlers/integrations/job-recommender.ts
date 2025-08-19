import axios, { AxiosInstance } from 'axios';
import { logger } from '../../logger';

let client: AxiosInstance | null = null;

export type JobRecommendationsRequest = {
  candidateId: string;
  kind: string;
  limit: number;
};

/**
 * A client for the Job Recommender service.
 */
export class JobRecommenderClient {
  constructor() {
    if (!client) {
      client = axios.create({
        baseURL: process.env.JOB_RECOMMENDER_BASE_URL,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
  }

  async createJobRecommendations(request: JobRecommendationsRequest): Promise<void> {
    if (!client) {
      logger.warn('JobRecommenderClient is not initialized');
      return;
    }

    const response = await client.post('/api/v1/job-recommendations', {
      candidate_id: request.candidateId,
      kind: request.kind,
      limit: request.limit,
    });

    if (response.status === 200) {
      logger.info(`Job recommendations are scheduled for creation for candidate ${request.candidateId}`);
    } else {
      logger.error(
        `Error while scheduling job recommendations creation for candidate ${request.candidateId}`,
        response.data,
      );
    }
  }
}
