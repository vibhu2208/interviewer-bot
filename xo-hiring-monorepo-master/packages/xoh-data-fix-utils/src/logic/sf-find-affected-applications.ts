import { defaultLogger, SalesforceClient } from '@trilogy-group/xoh-integration';
import {
  AffectedApplicationsData,
  Application,
  ApplicationStepPipelineMapping,
  ApplicationStepResult,
  SObjectHistory,
} from './model';

const log = defaultLogger();

/**
 * Given the ASR Ids that probably have failed find the affected applications that has been rejected due to it.
 * This function can be used to restore the application state after the data repair.
 * It accepts the ASR Ids array to optimize execution time with bulk operations where possible
 */
export async function findAffectedApplications(
  asrIds: string[],
  sf: SalesforceClient,
  bulkMaxSize = 20,
): Promise<AffectedApplicationsData[]> {
  const result: AffectedApplicationsData[] = [];

  for (let i = 0; i < asrIds.length; i += bulkMaxSize) {
    const bulkPart = asrIds.slice(i, i + bulkMaxSize);
    log.debug(
      `[fetchBulkAffectedApplicationsData] Querying ASR batch ${i + 1}-${i + 1 + bulkPart.length}/${asrIds.length}...`,
    );

    const part: AffectedApplicationsData[] = bulkPart.map((it) => ({ asrId: it } as AffectedApplicationsData));

    await fetchApplicationStepResults(part, sf);
    await fetchDependantApplications(part, sf);
    await fetchApplicationStepResultHistory(part, sf);
    await fetchApplicationHistory(part, sf);

    result.push(...part);
  }

  return result;
}

async function fetchApplicationStepResults(
  data: AffectedApplicationsData[],
  sf: SalesforceClient,
): Promise<AffectedApplicationsData[]> {
  const asrIds = data.map((it) => `'${it.asrId}'`).join(',');
  const result = await sf.querySOQL<ApplicationStepResult>(`
      SELECT
          Candidate__c,
          ApplicationId__r.Candidate_Email__c,
          ApplicationId__c,
          ApplicationId__r.Advertised_Title__c,
          Id,
          Score__c,
          Raw_Score__c,
          Application_Step_Id__c,
          Application_Step_Id__r.Name,
          Application_Stage__c,
          ApplicationId__r.StageName,
          Threshold__c,
          Reject_Threshold__c,
          State__c,
          Badge_Simulated__c
      FROM Application_Step_Result__c
      WHERE Id IN (${asrIds})
  `);
  for (const asr of result) {
    const entry = data.find((it) => it.asrId === asr.Id);
    if (entry != null) {
      entry.asr = asr;
    }
  }
  return data;
}

async function fetchDependantApplications(
  data: AffectedApplicationsData[],
  sf: SalesforceClient,
): Promise<AffectedApplicationsData[]> {
  const allCandidates = data.map((it) => `'${it.asr.Candidate__c}'`).join(',');
  const allApplications = await sf.querySOQL<Application>(
    `
      SELECT 
        Id, 
        StageName, 
        Pipeline__c, 
        Advertised_Title__c, 
        AccountId, 
        Last_Active_Stage__c,
        Account.Name,
        Account.PersonEmail
      FROM Opportunity WHERE AccountId IN (${allCandidates})`,
  );
  const allAffectedApplicationSteps = data.map((it) => `'${it.asr.Application_Step_Id__c}'`).join(',');
  const allRelatedStepMappings = await sf.querySOQL<ApplicationStepPipelineMapping>(`
    SELECT 
        ApplicationStepId__c, 
        PipelineId__c, 
        Pass_Threshold__c, 
        Reject_Threshold__c, 
        Retry_Threshold__c,
        Minimum_Proficiency__r.Stars__c,
        Minimum_Proficiency__r.Pass_Threshold__c
    FROM ApplicationStepPipelineMapping__c 
    WHERE ApplicationStepId__c IN (${allAffectedApplicationSteps})`);

  for (const affected of data) {
    affected.applications = allApplications.filter((app) => {
      if (app.AccountId !== affected.asr.Candidate__c) {
        return false;
      }
      // The app.Pipeline should have mapping to the same Application Step as the ASR
      const relatedMapping = allRelatedStepMappings.find(
        (it) => it.PipelineId__c === app.Pipeline__c && it.ApplicationStepId__c === affected.asr.Application_Step_Id__c,
      );
      if (relatedMapping != null) {
        app.aspm = relatedMapping;
      }
      return relatedMapping != null;
    });
  }

  return data;
}

async function fetchApplicationStepResultHistory(
  data: AffectedApplicationsData[],
  sf: SalesforceClient,
): Promise<AffectedApplicationsData[]> {
  const allAsrIds = data.map((it) => `'${it.asrId}'`).join(',');
  const result = await sf.querySOQL<SObjectHistory>(`
      SELECT CreatedDate, ParentId, Field, OldValue, NewValue
      FROM Application_Step_Result__History
      WHERE ParentId IN (${allAsrIds})
      ORDER BY CreatedDate DESC`);
  for (const affected of data) {
    affected.asr.history = result.filter((it) => it.ParentId === affected.asrId);
  }
  return data;
}

async function fetchApplicationHistory(
  data: AffectedApplicationsData[],
  sf: SalesforceClient,
): Promise<AffectedApplicationsData[]> {
  const allApplicationIds = data
    .map((it) => it.applications)
    .flat()
    .map((it) => `'${it.Id}'`)
    .join(',');
  const result = await sf.querySOQL<SObjectHistory>(`
      SELECT CreatedDate, Field, OldValue, NewValue, OpportunityId
      FROM OpportunityFieldHistory
      WHERE OpportunityId IN (${allApplicationIds})
      ORDER BY CreatedDate DESC`);
  for (const affected of data) {
    for (const app of affected.applications) {
      app.history = result.filter((it) => it.OpportunityId === app.Id);
    }
  }
  return data;
}
