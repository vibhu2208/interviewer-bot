import { Salesforce, SalesforceClient, defaultLogger } from '@trilogy-group/xoh-integration';
import { SSMConfig } from '../config/ssm.config';
import { OpenSearchClient } from '../integrations/opensearch.client';
import { SummaryGeneratorService } from '../services/summary-generator.service';

const log = defaultLogger({ serviceName: 'summary-generator.task' });
Salesforce.silent();

export async function generateSummary(
  transcriptId: string,
  forcePromptId: string | null = null,
  save = true,
): Promise<string> {
  let sfClient: SalesforceClient;
  let osClient: OpenSearchClient;

  try {
    sfClient = await Salesforce.getDefaultClient();

    const appConfig = await SSMConfig.getForEnvironment();
    if (!appConfig || !appConfig.opensearch) {
      throw new Error('Failed to load application configuration or OpenSearch config is missing.');
    }

    osClient = OpenSearchClient.getInstance(appConfig);
  } catch (error) {
    log.error('Failed to initialize Salesforce or OpenSearch client, or load app config', error as Error);
    throw new Error('Could not initialize clients or load configuration for summary generation.');
  }

  const summaryService = new SummaryGeneratorService(sfClient, osClient);
  return summaryService.generateSummary(transcriptId, forcePromptId, save);
}
