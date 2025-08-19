import { defaultLogger, SalesforceClient } from '@trilogy-group/xoh-integration';
import { Kontent } from '../internal-handlers/integrations/kontent';

const log = defaultLogger();

/**
 * Fetches pipeline data from Salesforce and Kontent
 */
export async function fetchKontentPipelineData(sf: SalesforceClient, pipelineId: string): Promise<PipelineData> {
  const pipelineQueryResult = await sf.querySOQL<PipelineRecord>(`
      SELECT Name, Keywords__c, Type__c, ProductCode FROM Product2 WHERE Id = '${pipelineId}'
    `);

  if (pipelineQueryResult.length === 0) {
    log.error(`Pipeline not found: ${pipelineId}`);
    throw new Error(`Pipeline not found: ${pipelineId}`);
  }

  const pipelineData = pipelineQueryResult[0];
  log.info(`Fetched pipeline code: ${pipelineData.ProductCode}`);

  log.info(`Fetching pipeline data from Kontent`);
  const kontentClient = await Kontent.deliveryClient();
  const item = await kontentClient.item(`pipeline_${pipelineData.ProductCode}`).toPromise();
  const elements = item.data.item.elements;

  return {
    name: pipelineData.Name,
    hook: elements['hook']?.value,
    requirements: elements['requirements']?.value,
    responsibilities: elements['responsibilities']?.value,
    what_you_will_be_doing: elements['what_you_will_be_doing']?.value,
    what_you_will_not_be_doing: elements['what_you_will_not_be_doing']?.value,
  };
}

export interface PipelineData {
  name: string;
  hook?: string;
  what_you_will_be_doing?: string;
  what_you_will_not_be_doing?: string;
  responsibilities?: string;
  requirements?: string;
}

export interface PipelineRecord {
  Name: string;
  Keywords__c: string;
  Type__c: string;
  ProductCode: string;
}
