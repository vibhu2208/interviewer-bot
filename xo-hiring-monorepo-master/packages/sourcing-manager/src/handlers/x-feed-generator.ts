import { Salesforce } from '@trilogy-group/xoh-integration';
import { DateTime } from 'luxon';
import * as xmlbuilder from 'xmlbuilder';
import { generateText } from 'ai';
import { Llm } from '@trilogy-group/xoh-integration';
import { FeedUploadService } from '../services/feed-upload-service';
import { LLMProjectName } from '../utils/common';

const ShortDescriptionGenerationPrompt = `
Create a short, catchy, clear, edgy short one sentence summary for this Job Description that includes the pay, the fact that the jobs is remote, use of AI and the most interesting challenge (focus on what candidate seek for, do not include boring things that are interesting for the employer)
focus on the job, not the company or the team. Output plain text only, no HTML or markdown, or any other formatting.
--
Job Title: {Job_Title}
Yearly Compensation: {Yearly_Comp}
Job Description: 
{Job_Description}`;
const GPT_BATCH_SIZE = 5;
const GPT_DELAY_MS = 5000;

interface LambdaInput {
  companyName?: string;
  companyId?: string;
}

export async function handler(input?: LambdaInput): Promise<void> {
  console.log('Starting campaign feed generation for X');

  if (process.env.OUTPUT_BUCKET == null) {
    throw new Error('OUTPUT_BUCKET env variable is required');
  }

  const campaigns = await getCampaigns();
  console.log(`Fetched ${campaigns.length} campaigns`);

  const xmlFeed = await generateXMLFeed(campaigns, input?.companyId, input?.companyName);
  console.log(xmlFeed);

  await FeedUploadService.uploadXMLToS3Bucket('x/x-jobs-feed.xml', xmlFeed);
}

export async function generateXMLFeed(
  campaigns: Campaign[],
  companyId?: string,
  companyName?: string,
): Promise<string> {
  const root = xmlbuilder.create('source', { encoding: 'UTF-8' });
  root.ele('lastBuildDate', DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'));

  // Generate job description for all jobs in parallel
  // TODO: Right now the upper limit of campaigns is ~50, consider bulk generation for larger number of campaigns
  console.log('Generating short descriptions for campaigns');
  const generationTasks = campaigns.map((it) => generateShortDescription(it));
  for (let i = 0; i < generationTasks.length; i += GPT_BATCH_SIZE) {
    const batch = generationTasks.slice(i, i + GPT_BATCH_SIZE);
    console.log(`Generating short descriptions for campaigns ${i + 1} to ${i + batch.length}`);
    await Promise.all(batch);
    if (i + GPT_BATCH_SIZE < generationTasks.length) {
      await new Promise((resolve) => setTimeout(resolve, GPT_DELAY_MS));
    }
  }
  console.log(`Short descriptions generated for ${generationTasks.length} campaigns`);

  for (const campaign of campaigns) {
    if (campaign.ShortJobDescription == null) {
      continue;
    }

    const job = root.ele('job');
    job.ele('partnerJobId').cdata(campaign.InternalId__c);
    job.ele('title').cdata(campaign.Ad_Title__c);
    job.ele('description').cdata(campaign.Description);
    job
      .ele('applyUrl')
      .cdata(
        `${campaign.Pipeline__r.Apply_URL__c}?utm_source=x&utm_medium=x_jobs&utm_campaign=${campaign.InternalId__c}`,
      );
    if (companyId != null) {
      job.ele('companyId').cdata(companyId);
    }
    job.ele('company').cdata(companyName ?? 'Crossover');
    job.ele('shortDescription').cdata(campaign.ShortJobDescription);
    job.ele('location').cdata('Remote');
    job.ele('workplaceType').cdata('remote');
    job.ele('experienceLevel').cdata(getExperienceLevel(campaign));
    job.ele('jobtype').cdata('full_time_contract');
    const salaries = job.ele('salaries').ele('salary');
    salaries.ele('highEnd').cdata(campaign.Pipeline__r.Yearly_Rate__c.toString());
    salaries.ele('lowEnd').cdata(campaign.Pipeline__r.Yearly_Rate__c.toString());
    salaries.ele('period').cdata('year');
    salaries.ele('currencyCode').cdata('USD');
    const formattedDate = DateTime.fromISO(campaign.Pipeline__r.Last_Open_Date__c).toFormat('yyyy-MM-dd');
    job.ele('listDate').cdata(formattedDate);
  }

  return root.end({ pretty: true });
}

async function generateShortDescription(campaign: Campaign): Promise<string> {
  const prompt = ShortDescriptionGenerationPrompt.replace('{Job_Title}', campaign.Ad_Title__c)
    .replace('{Yearly_Comp}', campaign.Pipeline__r.Yearly_Rate__c.toString())
    .replace('{Job_Description}', campaign.Description);

  const model = await Llm.getDefaultModel(LLMProjectName);

  const response = await generateText({
    temperature: 0,
    prompt,
    model,
  });

  if (!response || !response.text) {
    throw new Error(`Failed to generate short description for campaign ${campaign.InternalId__c}`);
  }

  campaign.ShortJobDescription = `<p>${response.text}</p>`;

  return campaign.ShortJobDescription;
}

function getExperienceLevel(campaign: Campaign): string {
  switch (campaign.Pipeline__r.LinkedIn_Experience_Level__c) {
    case 'Internship':
    case 'Entry Level':
      return 'entry_level';
    case 'Associate':
      return 'junior';
    case 'Mid-Senior level':
      return 'mid_level';
    case 'Director':
      return 'senior';
    case 'Executive':
      return 'executive';
    default:
      return 'mid_level'; // Default to mid_level if no match
  }
}

async function getCampaigns(): Promise<Campaign[]> {
  const sf = await Salesforce.getDefaultClient();
  const query = `
    SELECT
      Id,
      Name,
      Type,
      InternalId__c,
      Ad_Title__c,
      Description,
      Pipeline__r.Yearly_Rate__c,
      Pipeline__r.Last_Open_Date__c,
      Pipeline__r.Apply_URL__c,
      Pipeline__r.LinkedIn_Experience_Level__c
    FROM Campaign
    WHERE RecordType.DeveloperName = 'X_Campaign'
    AND Status IN ('In Progress', 'Planned')
  `;
  return await sf.querySOQL<Campaign>(query);
}

export interface Campaign {
  ShortJobDescription?: string; // Will be generated

  Id: string;
  Name: string;
  Type: string;
  InternalId__c: string;
  Ad_Title__c: string;
  Description: string;
  Pipeline__r: {
    Yearly_Rate__c: number;
    Last_Open_Date__c: string;
    Apply_URL__c: string;
    LinkedIn_Experience_Level__c:
      | 'Not Applicable'
      | 'Internship'
      | 'Entry Level'
      | 'Associate'
      | 'Mid-Senior level'
      | 'Director'
      | 'Executive';
  };
}
