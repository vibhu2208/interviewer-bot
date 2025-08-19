import { defaultLogger } from '@trilogy-group/xoh-integration';
import { CandidateData } from '../models/summary-generator.model';
import { OpenSearchClient } from '../integrations/opensearch.client';

const log = defaultLogger({ serviceName: 'candidate-data.service' });

export class CandidateDataService {
  private readonly openSearchClient: OpenSearchClient;

  constructor(openSearchClient: OpenSearchClient) {
    this.openSearchClient = openSearchClient;
  }

  /**
   * Fetches candidate resume and profile data from OpenSearch.
   */
  public async getCandidateResume(candidateId: string): Promise<CandidateData | undefined> {
    if (!candidateId) {
      log.warn('Skipping getCandidateResume fetch: candidateId is missing.');
      return undefined;
    }

    try {
      const candidateDocument = await this.openSearchClient.getCandidate(candidateId);

      const resumeFile = candidateDocument?.body?.['_source']?.resumeFile ?? undefined;
      const resumeProfile = candidateDocument?.body?.['_source']?.resumeProfile ?? undefined;

      if (resumeFile || resumeProfile) {
        log.info(
          `Fetched candidate resume for ${candidateId}. File length: ${resumeFile?.length}, Profile length: ${resumeProfile?.length}`,
        );
        return {
          resume: resumeFile,
          profile: resumeProfile,
        };
      } else {
        log.warn(`No resume data found in OpenSearch for candidateId: ${candidateId}`);
        return undefined;
      }
    } catch (error) {
      log.error(`Error fetching candidate resume for ${candidateId} from OpenSearch:`, error as Error);
      return undefined; // Return undefined on error to allow graceful degradation
    }
  }
}
