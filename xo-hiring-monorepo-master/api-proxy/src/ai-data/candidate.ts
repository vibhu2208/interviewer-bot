import { defaultLogger, SalesforceClient } from '@trilogy-group/xoh-integration';
import { OpenSearchClient } from '../internal-handlers/integrations/opensearch';
import { SSMConfig } from '../ssm-config';

const log = defaultLogger();

/**
 * Fetches candidate resume from OpenSearch
 */
export async function fetchCandidateResume(candidateId: string): Promise<CandidateData> {
  try {
    const config = await SSMConfig.getForEnvironment();
    const openSearchClient = OpenSearchClient.default(config);

    const candidateDocument = await openSearchClient.getCandidate(candidateId);
    const candidateResumeFile = candidateDocument?.body?.['_source']?.resumeFile ?? undefined;
    const candidateResumeProfile = candidateDocument?.body?.['_source']?.resumeProfile ?? undefined;

    log.info(
      `Fetched candidate resume, file length: ${candidateResumeFile?.length}, profile length: ${candidateResumeProfile?.length}`,
    );

    return {
      resume: candidateResumeFile,
      profile: candidateResumeProfile,
    };
  } catch (e) {
    log.error('Error fetching candidate resume', e as Error);
    return {
      resume: undefined,
      profile: undefined,
    };
  }
}

export interface CandidateData {
  resume?: string;
  profile?: string;
}

/**
 * Fetches candidate details from Salesforce
 */
export async function fetchCandidateDetails(sf: SalesforceClient, candidateId: string) {
  return await sf.querySOQL<{ Name: string; Description: string }>(`
      SELECT
        Name,
        Description
      FROM Account
      WHERE Id = '${candidateId}'
    `);
}

/**
 * Fetches candidate assessments from Salesforce
 */
export async function fetchCandidateAssessments(
  sf: SalesforceClient,
  candidateId: string,
): Promise<CandidateAssessment[]> {
  return await sf.querySOQL<CandidateAssessment>(`
      SELECT 
          Name,
          Application_Step_Id__r.Display_Name__c,
          Badge_Earned__r.Display_Name__c,
          Badge_Earned__r.Stars__c,
          ApplicationId__c,
          Application_Step_Id__r.Badge_Description__c,
          Application_Step_Id__r.Badge_Max_Proficiency__c,
          Application_Step_Id__r.Provider__c,
          Application_Step_Id__r.External_Submission_Assessment_ID__c,
          External_Submission_Id__c
      FROM Application_Step_Result__c 
      WHERE Candidate__c = '${candidateId}'
      AND Score__c != NULL
    `);
}

export interface BadgeData {
  name: string;
  description: string;
  level: string;
  proficiency: number;
  maxProficiency: number;
}

export interface CandidateAssessment {
  Name: string;
  Application_Step_Id__r: {
    Display_Name__c: string;
    Badge_Description__c: string;
    Badge_Max_Proficiency__c: number;
    Provider__c: string;
    External_Submission_Assessment_ID__c: string;
  };
  Badge_Earned__r: {
    Display_Name__c: string;
    Stars__c: number;
  };
  ApplicationId__c: string;
  External_Submission_Id__c: string;
}

/**
 * Extracts badge data from candidate assessments
 */
export function getBadgesData(assessments: CandidateAssessment[]): BadgeData[] {
  return assessments
    .filter(
      (assessment) =>
        assessment.Badge_Earned__r?.Display_Name__c != null &&
        assessment.Application_Step_Id__r?.Badge_Description__c != null,
    )
    .map((assessment) => ({
      name: assessment.Application_Step_Id__r.Display_Name__c,
      description: assessment.Application_Step_Id__r.Badge_Description__c,
      level: assessment.Badge_Earned__r.Display_Name__c,
      proficiency: assessment.Badge_Earned__r.Stars__c,
      maxProficiency: assessment.Application_Step_Id__r.Badge_Max_Proficiency__c,
    }));
}
