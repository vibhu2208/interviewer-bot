import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';
import { EventBridgeEvent } from 'aws-lambda';
import { Jira } from './jira';
import { querySalesforce } from './salesforce';

export async function handler(event: EventBridgeEvent<string, string>): Promise<void> {
  console.log('EVENT', event);

  const config = await fetchSSMConfig();
  console.log(`Retrieved SSM config`, config);

  let candidates = await getCandidates();
  console.log(`Fetched ${candidates.length} candidates, checking for exclusions`);

  candidates = checkExcluded(config, candidates);
  console.log(`${candidates.length} candidates left after filtration`);

  if (candidates.length == 0) {
    return;
  }

  for (const candidate of candidates) {
    try {
      await createJiraTicket(candidate);
    } catch (e) {
      console.error(`Cannot create jira ticket for candidate ${candidate}`, e);
    }
  }
}

async function fetchSSMConfig(): Promise<Configuration> {
  const ssmClient = new SsmEditor({
    productName: 'xo-hiring-bfq-verification',
    environment: process.env.ENV ?? 'sandbox',
  });
  const config: { excludedPipelines: string; excludedCompanies: string } = await ssmClient.getConfigurationObject();
  return {
    excludedPipelines: config.excludedPipelines.split(','),
    excludedCompanies: config.excludedCompanies.split(','),
  };
}

async function createJiraTicket(candidate: CandidateData): Promise<void> {
  const existingIssue = await Jira.findExistingBfqVerificationTicket(candidate.ApplicationId__c);
  if (existingIssue != null) {
    console.log(`Existing issue detected for application ${candidate.Candidate__c}: ${existingIssue}`);
    return;
  }

  const created = await Jira.createBfqVerificationTicket(
    candidate.ApplicationId__c,
    candidate.ApplicationId__r.Pipeline__r.ProductCode,
  );
  console.log(`Created new issue for application ${candidate.Candidate__c}: ${created}`);
}

function checkExcluded(config: Configuration, candidates: CandidateData[]): CandidateData[] {
  return candidates
    .filter((it) => !config.excludedCompanies.includes(it.ApplicationId__r.Pipeline__r.Brand__c))
    .filter((it) => !config.excludedPipelines.includes(`${it.ApplicationId__r.Pipeline__r.ProductCode}`));
}

async function getCandidates(): Promise<CandidateData[]> {
  const candidatesResponse = await querySalesforce<CandidateData>(`
    SELECT ApplicationId__c, PipelineId__c, Candidate__c,
           ApplicationId__r.Pipeline__r.Name,
           ApplicationId__r.Pipeline__r.ProductCode,
           ApplicationId__r.Pipeline__r.Brand__c
    FROM Application_Step_Result__c 
    WHERE 
      Application_Stage__c = 'Offer' 
      AND State__c != 'Cancelled' 
      AND CreatedDate >= LAST_N_DAYS:25`);

  if (!candidatesResponse.done || candidatesResponse.records.length === 0) {
    return [];
  }

  return candidatesResponse.records;
}

interface CandidateData {
  ApplicationId__c: string;
  PipelineId__c: string;
  Candidate__c: string;
  ApplicationId__r: {
    Pipeline__r: {
      Name: string;
      ProductCode: number;
      Brand__c: string;
    };
  };
}

interface Configuration {
  excludedCompanies: string[];
  excludedPipelines: string[];
}
