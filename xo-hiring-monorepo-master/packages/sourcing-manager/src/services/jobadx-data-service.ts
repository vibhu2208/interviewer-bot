import { defaultLogger, SalesforceClient } from '@trilogy-group/xoh-integration';

const logger = defaultLogger({ serviceName: 'jobadx-data-service' });
logger.setLogLevel('DEBUG');

export interface Pipeline {
  ProductCode: string;
  Brand__r: {
    Name: string;
  };
  CreatedDate: string;
  Yearly_Rate__c: number;
  Job_Type__c: string;
  Family: string;
  Target_CPA__c: number;
}

export interface JobBoardCell {
  Location__c: string;
  Location__r: {
    State_Code__c: string;
  };
  Pipeline_Job_Title__c: string;
  Pipeline_Job_Title__r: {
    Landing_Page_URL__c: string;
  };
}

export interface WorkLocation {
  Pipeline__c: string;
}

export interface Campaign {
  Id: string;
  InternalId__c: string;
  Ad_Title__c: string;
  Description: string;
  Ad_Posted_Country_Name__c: string;
  Ad_Posted_Location_Name__c: string;
  Pipeline__c: string;
  Pipeline__r: Pipeline;
  Job_Board_Cell__r: JobBoardCell;
}

export interface Country {
  Code__c: string;
  Label: string;
}

/**
 * Retrieves active pipeline Ids with work locations.
 * @param sf Salesforce client
 * @returns Set of pipeline Ids with work locations
 */
export async function getActivePipelinesWithWorkLocations(sf: SalesforceClient): Promise<Set<string>> {
  const query = `
    SELECT 
        Pipeline__c
    FROM Work_Location__c
    WHERE Pipeline__r.Status__c = 'Active' 
    GROUP BY Pipeline__c
  `;

  const workLocations = await sf.querySOQL<WorkLocation>(query);

  logger.info(`Loaded ${workLocations.length} active pipelines with work locations`);

  return new Set(workLocations?.map((workLocation) => workLocation.Pipeline__c) ?? []);
}

export async function getCountryNameToCodeMap(sf: SalesforceClient): Promise<Record<string, string>> {
  const query = `
    SELECT
        Code__c,
        Label
    FROM Country__mdt
  `;

  const countries = await sf.querySOQL<Country>(query);

  return countries.reduce((acc, country) => {
    acc[country.Label] = country.Code__c;
    return acc;
  }, {} as Record<string, string>);
}

export async function getJobAdXCampaigns(sf: SalesforceClient): Promise<Campaign[]> {
  logger.info('Loading JobAdX campaigns from salesforce...');

  const query = `
    SELECT 
        Id, 
        InternalId__c, 
        Ad_Title__c, 
        Description,
        Ad_Posted_Country_Name__c, 
        Ad_Posted_Location_Name__c,
        Pipeline__c,
        Pipeline__r.ProductCode, 
        Pipeline__r.Brand__r.Name,
        Pipeline__r.CreatedDate, 
        Pipeline__r.Yearly_Rate__c,
        Pipeline__r.Job_Type__c,
        Pipeline__r.Target_CPA__c,
        toLabel(Pipeline__r.Family),
        Job_Board_Cell__c, 
        Job_Board_Cell__r.Location__c,
        Job_Board_Cell__r.Location__r.State_Code__c,
        Job_Board_Cell__r.Pipeline_Job_Title__c,
        Job_Board_Cell__r.Pipeline_Job_Title__r.Landing_Page_URL__c
    FROM Campaign
    WHERE RecordType.DeveloperName = 'JobAdx_Campaign'
        AND Status IN ('In Progress')
        AND Job_Board_Cell__c != NULL
  `;

  const campaigns = await sf.querySOQL<Campaign>(query);

  logger.info(`Loaded ${campaigns.length} campaigns`);

  return campaigns;
}
