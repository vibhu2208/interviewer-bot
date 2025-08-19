import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';
import { GradingMode } from '../model/grading-task';

export async function querySalesforce<T>(q: string): Promise<SalesforceResponse<T>> {
  const sfClient = await getSalesforceClient();

  const response = await sfClient.get('/services/data/v57.0/query', {
    params: { q: q.replace(/\n/, ' ') },
  });

  return response.data;
}

export interface SalesforceResponse<T> {
  totalSize: number;
  done: boolean;
  records: T[];
}

export interface GradingRuleC {
  Id: string;
  Name: string;
  Active__c: boolean;
  Rule__c: string;
  Pass_Examples__c: string | null;
  Fail_Examples__c: string | null;
  Application_Step__c: string;
  SM_Key_Name_Pattern__c: string | null;
  AI_Grading_Mode__c: string | null;
  Score__c: string | null;
  Content_Type__c: 'Auto' | 'Text' | 'URL' | null;
  Model__c: string | null;
}

export interface ApplicationStepC {
  XO_Grading_Mode__c: GradingMode | null;
}
