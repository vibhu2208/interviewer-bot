import { SalesforceClient } from '@trilogy-group/xoh-integration';

export enum CurrencyConfig {
  USDCode = 'USDCode',
  USDSymbol = 'USDSymbol',
  LocalCode = 'LocalCode',
  LocalSymbol = 'LocalSymbol',
  LocalPlain = 'LocalPlain',
}

export enum SalaryTimeUnit {
  Year = 'year',
  Month = 'month',
  Hour = 'hour',
}

export interface EventPayload {
  Currency?: string;
  SalaryTimeUnit?: string;
  ListAllAdsUnderCrossover?: boolean;
}

export interface Config {
  Currency: CurrencyConfig;
  SalaryTimeUnit: SalaryTimeUnit;
  ListAllAdsUnderCrossover: boolean;
}

/**
 * Returns actual configuration taking into account event and default values.
 * @param event  lambda event containing values that allows to specify configuration parameters
 */
export async function getConfig(event: EventPayload): Promise<Config> {
  // Validation
  if (
    event.Currency !== undefined &&
    event.Currency !== null &&
    !Object.values(CurrencyConfig).includes(event.Currency as CurrencyConfig)
  ) {
    throw Error(
      `event.Currency has incorrect value "${event.Currency}", ` +
        `should be one of the following ${Object.keys(CurrencyConfig)}`,
    );
  }
  if (
    event.SalaryTimeUnit !== undefined &&
    event.SalaryTimeUnit !== null &&
    !Object.values(SalaryTimeUnit).includes(event.SalaryTimeUnit as SalaryTimeUnit)
  ) {
    throw Error(
      `event.SalaryTimeUnit has incorrect value "${event.SalaryTimeUnit}", ` +
        `should be one of the following ${Object.values(SalaryTimeUnit)}`,
    );
  }

  // Applying default values
  return {
    Currency: (event.Currency as CurrencyConfig) ?? CurrencyConfig.USDSymbol,
    SalaryTimeUnit: (event.SalaryTimeUnit as SalaryTimeUnit) ?? SalaryTimeUnit.Year,
    ListAllAdsUnderCrossover: event.ListAllAdsUnderCrossover ?? false,
  };
}
export interface Country {
  Code__c: string;
  Label: string;
  Currency__c: string;
  Exchange_Rate__c: number;
  Currency_Symbol__c: string;
}

export async function getCountries(sf: SalesforceClient): Promise<Country[]> {
  return await sf.querySOQL<Country>(`
    SELECT 
        Code__c, 
        Label, 
        Currency__c, 
        Exchange_Rate__c, 
        Currency_Symbol__c 
    FROM Country__mdt
  `);
}

export interface Campaign {
  Id: string;
  Name: string;
  Type: string;
  InternalId__c: string;
  Ad_Title__c: string;
  Description: string;
  Ad_Posted_Country_Name__c: string;
  Ad_Posted_Location_Name__c: string;
  Pipeline__r: {
    Name: string;
    ProductCode: string;
    Brand__r: {
      Name: string;
    };
    CreatedDate: string;
    Geographic_Restriction__c: string;
    Hourly_Rate__c: number;
    Yearly_Rate__c: number;
    Monthly_Rate__c: number;
    Job_Type__c: string;
    Hours_per_Week__c: number;
  };
  Job_Board_Cell__r: {
    Location__r: {
      Is_Country__c: boolean;
      State_Code__c: string;
    };
    Pipeline_Job_Title__r: {
      Landing_Page_URL__c: string;
      Apply_URL__c: string;
    };
  };
}

export async function getCampaigns(sf: SalesforceClient): Promise<Campaign[]> {
  const query = `
    SELECT 
        Id, 
        Name, 
        Type, 
        InternalId__c, 
        Ad_Title__c, 
        Description,
        Ad_Posted_Country_Name__c, 
        Ad_Posted_Location_Name__c,
        Pipeline__r.Name, 
        Pipeline__r.ProductCode, 
        Pipeline__r.Brand__r.Name,
        Pipeline__r.CreatedDate, 
        Job_Board_Cell__c, 
        Pipeline__r.Geographic_Restriction__c,
        Job_Board_Cell__r.Location__r.Is_Country__c,
        Job_Board_Cell__r.Location__r.State_Code__c,
        Job_Board_Cell__r.Pipeline_Job_Title__r.Landing_Page_URL__c,
        Job_Board_Cell__r.Pipeline_Job_Title__r.Apply_URL__c,
        Pipeline__r.Hourly_Rate__c,
        Pipeline__r.Yearly_Rate__c,
        Pipeline__r.Monthly_Rate__c,
        Pipeline__r.Job_Type__c,
        Pipeline__r.Hours_per_Week__c
    FROM Campaign
    WHERE RecordType.DeveloperName = 'Recruitics_Campaign'
        AND Status IN ('In Progress', 'Planned')
        AND Job_Board_Cell__c != NULL
  `;

  return await sf.querySOQL<Campaign>(query);
}
