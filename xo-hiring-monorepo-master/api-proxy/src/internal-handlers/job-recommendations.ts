import { logger } from '../logger';
import { JobRecommenderClient } from './integrations/job-recommender';

export type JobRecommendationsCandidateInput = {
  Id: string;
  HasResume__c: boolean;
  CCAT_Score__c: string;
  Job_Recommendations__r?: { totalSize: number } | null;
};

export function shouldRecommendJobs(candidate: JobRecommendationsCandidateInput) {
  return (
    candidate.HasResume__c &&
    candidate.CCAT_Score__c &&
    Number(candidate.CCAT_Score__c) >= 35 &&
    !(candidate.Job_Recommendations__r && candidate.Job_Recommendations__r.totalSize > 0)
  );
}

export async function recommendJobs(candidate: JobRecommendationsCandidateInput) {
  try {
    if (!shouldRecommendJobs(candidate)) {
      return;
    }

    logger.info(`Preparing job recommendations for candidate ${candidate.Id}...`);
    const client = new JobRecommenderClient();
    await client.createJobRecommendations({
      candidateId: candidate.Id,
      kind: 'website',
      limit: 5,
    });
  } catch (ex) {
    logger.error(`Error while preparing job recommendations for candidate ${candidate.Id}`, ex as Error);
  }
}

export async function recommendJobsByJobRoleApplication(candidateId: string) {
  try {
    logger.info(`Preparing job recommendations based on job role application for candidate ${candidateId}...`);
    const client = new JobRecommenderClient();
    await client.createJobRecommendations({
      candidateId: candidateId,
      kind: 'job_role',
      limit: 5,
    });
  } catch (ex) {
    logger.error(
      `Error while preparing job recommendations based on job role application for candidate ${candidateId}`,
      ex as Error,
    );
  }
}
