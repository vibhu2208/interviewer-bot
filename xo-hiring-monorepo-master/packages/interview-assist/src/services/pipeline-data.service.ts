import { SalesforceClient, defaultLogger } from '@trilogy-group/xoh-integration';
import { Kontent } from '../integrations/kontent';
import { KontentPipelineDescription, KontentPipelineItem } from '../models/summary-generator.model';

const log = defaultLogger({ serviceName: 'pipeline-data-service' });

export class PipelineDataService {
  private readonly sfClient: SalesforceClient;

  constructor(sfClient: SalesforceClient) {
    this.sfClient = sfClient;
  }

  /**
   * Fetches pipeline Name and ProductCode from Salesforce using pipelineId,
   * then fetches full description from Kontent using ProductCode.
   */
  public async getPipelineDescription(pipelineId: string): Promise<KontentPipelineDescription | null> {
    if (!pipelineId) {
      log.warn('getPipelineDescription called without pipelineId.');
      return null;
    }

    let productCode: string | undefined;
    let pipelineName: string | undefined;

    try {
      const pipelineSfDetails = await this.sfClient.querySOQL<{
        ProductCode: string;
        Name: string;
      }>(`SELECT Name, ProductCode FROM Product2 WHERE Id = '${pipelineId}' LIMIT 1`);

      if (pipelineSfDetails.length > 0) {
        productCode = pipelineSfDetails[0].ProductCode;
        pipelineName = pipelineSfDetails[0].Name;
        log.info(
          `Fetched Salesforce details for Pipeline ID ${pipelineId}: Name=${pipelineName}, ProductCode=${productCode}`,
        );
      } else {
        log.warn(`No Salesforce details found for Pipeline ID: ${pipelineId}`);
        return null;
      }
    } catch (error) {
      log.error(`Error fetching Salesforce details for Pipeline ID ${pipelineId}:`, error as Error);
      return null;
    }

    if (!productCode || !pipelineName) {
      log.warn(`ProductCode or PipelineName missing for Pipeline ID: ${pipelineId} after SF query.`);
      return null;
    }

    log.info(`Fetching Kontent pipeline data for ProductCode: ${productCode}`);
    const kontentClient = await Kontent.deliveryClient();
    const response = await kontentClient
      .items<KontentPipelineItem>()
      .type('pipeline')
      .elementsParameter([
        'hook',
        'what_you_will_be_doing',
        'what_you_will_not_be_doing',
        'responsibilities',
        'requirements',
        'nice_to_have',
        'what_you_will_learn',
        'work_examples',
      ])
      .inFilter('elements.pipeline_code', [`${productCode}`])
      .depthParameter(2)
      .toPromise();

    if (response.data.items.length === 0) {
      log.warn(`No Kontent data for pipeline found for ProductCode: ${productCode}`);
      return null;
    }
    const data = response.data.items[0].elements;

    return {
      pipeline_code: productCode,
      pipeline_name: pipelineName,
      hook: data.hook.value,
      what_you_will_be_doing: data.what_you_will_be_doing.value,
      what_you_will_not_be_doing: data.what_you_will_not_be_doing.value,
      responsibilities: data.responsibilities.value,
      requirements: data.requirements.value,
      nice_to_have: data.nice_to_have.value,
      what_you_will_learn: data.what_you_will_learn.value,
      work_examples: data.work_examples.value,
    };
  }
}
