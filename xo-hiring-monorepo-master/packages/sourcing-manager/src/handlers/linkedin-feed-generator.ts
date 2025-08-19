import { defaultLogger, Salesforce, SalesforceIntegrationLogger } from '@trilogy-group/xoh-integration';
import { DateTime } from 'luxon';
import { create } from 'xmlbuilder2';
import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';
import { FeedUploadService } from '../services/feed-upload-service';
import {
  Country,
  LinkedInBrand,
  LinkedInCampaign,
  LinkedInConfiguration,
  LinkedInDataService,
  LinkedInExperienceLevel,
  LinkedInIndustries,
  LinkedInJobFunctions,
  LinkedInJobType,
  LinkedInWorkplaceType,
} from '../services/linkedin-data-service';

const log = defaultLogger({ serviceName: 'linkedin-feed-generator' });
SalesforceIntegrationLogger.setLogLevel('WARN');

export interface FeedGenerationData {
  config: LinkedInConfiguration;
  countries: Country[];
  masterBrand: LinkedInBrand | null;
}

export async function generateLinkedInXMLFeed(): Promise<void> {
  log.info('Loading data from Salesforce...');
  const sf = await Salesforce.getAdminClient();

  // Fetch LinkedIn configuration
  const config = await LinkedInDataService.getConfig(sf);
  const campaigns = await LinkedInDataService.fetchCampaigns(sf);
  const masterBrand = await LinkedInDataService.fetchMasterBrand(sf, config.Master_Brand_Id__c);
  const countries = await LinkedInDataService.fetchCountries(sf);
  log.info(
    `Fetched ${campaigns.length} campaigns, ${countries.length} countries, master brand is ${
      masterBrand?.Name ?? 'NULL'
    }`,
  );
  log.info(`Config`, {
    config: config,
  });

  log.info(`Building XML feed for ${campaigns.length} campaigns`);
  const xmlFeed = buildLinkedInJobFeedXml(campaigns, {
    config,
    countries,
    masterBrand,
  });

  if (process.env.DRY_RUN !== 'true') {
    await FeedUploadService.uploadXMLToS3Bucket('linkedin/linkedin-jobs-feed.xml', xmlFeed);
  }
}

export function buildLinkedInJobFeedXml(campaigns: LinkedInCampaign[], data: FeedGenerationData): string {
  const xml = create({
    version: '1.0',
    encoding: 'UTF-8',
  });

  const source = xml.ele('source');

  // RFC 822 date format
  source.ele('lastBuildDate').txt(DateTime.now().toRFC2822());

  campaigns.forEach((campaign) => {
    buildJobXml(source, campaign, data);
  });

  return xml.doc().end({ prettyPrint: true });
}

function buildJobXml(source: XMLBuilder, campaign: LinkedInCampaign, data: FeedGenerationData): void {
  try {
    // Validate required fields
    if (!campaign.Ad_Title__c || !campaign.Description) {
      log.error(
        `[${campaign.Id} - ${campaign.InternalId__c}] Invalid campaign data (missing required fields) - ${campaign.Ad_Title__c} - ${campaign.Description}`,
      );
      return;
    }

    const job = source.ele('job');
    job.ele('partnerJobId').dat(campaign.InternalId__c);

    // Company
    job.ele('company').dat(data.masterBrand?.Name ?? campaign.Pipeline__r.Brand__r.Name);
    job
      .ele('companyId')
      .dat(`${data.masterBrand?.LinkedIn_Company_ID__c ?? campaign.Pipeline__r.Brand__r.LinkedIn_Company_ID__c}`);

    // Job description
    writeJobPosition(job, campaign, data);

    // Apply urls
    writeUrls(job, campaign);
  } catch (error) {
    log.error(
      `[${campaign.Id} - ${campaign.InternalId__c}] Error while generating feed for the campaign: ${error}`,
      error as Error,
    );
  }
}

function writeJobPosition(job: XMLBuilder, campaign: LinkedInCampaign, data: FeedGenerationData): void {
  writeTitleDescription(job, campaign, data);
  writeTypeLevel(job, campaign);
  writeLocation(job, campaign, data);
  writeJobFunctions(job, campaign);
  writeIndustryCodes(job, campaign);
  writeSkills(job, campaign);
  writeSalaries(job, campaign);
}

function writeLocation(job: XMLBuilder, campaign: LinkedInCampaign, data: FeedGenerationData): void {
  // LI expects country code in the country field
  const country = campaign.Ad_Posted_Country_Name__c
    ? data.countries.find((item) => item.Label === campaign.Ad_Posted_Country_Name__c) ?? null
    : null;
  const countryCode = country?.Code__c ?? null;
  if (countryCode == null) {
    throw new Error(`Missing country code for the country ${campaign.Ad_Posted_Country_Name__c}`);
  }
  job.ele('country').dat(countryCode);

  // Set city field if present
  if (campaign.Job_Board_Cell__r.Location__r.City_Name__c != null) {
    job.ele('city').dat(campaign.Job_Board_Cell__r.Location__r.City_Name__c);
  }
  // Set state name if present
  if (campaign.Job_Board_Cell__r.Location__r.State_Name__c != null) {
    job.ele('state').dat(campaign.Job_Board_Cell__r.Location__r.State_Name__c);
  }

  if (campaign.Pipeline__r.Geographic_Restriction__c !== 'City') {
    // Mark as remote
    job.ele('workplaceTypes').dat(LinkedInWorkplaceType.Remote);
  }
}

function writeTitleDescription(job: XMLBuilder, campaign: LinkedInCampaign, data: FeedGenerationData): void {
  job.ele('title').dat(campaign.Ad_Title__c);

  // Description with job code and hashtags
  const description = campaign.Description.replace(/\n/g, '<br />\n');
  const crossoverJobCode = `Crossover Job Code: ${campaign.InternalId__c}<br/>`;
  const hashTag =
    campaign.Type === 'LinkedIn Free Ads'
      ? data.config.LinkedIn_Job_Tag_Free_Listing__c
      : data.config.LinkedIn_Job_Tag_Slot__c;
  const remoteTag = campaign.Pipeline__r.Geographic_Restriction__c !== 'City' ? ' #LI-remote' : '';

  // LI supports a selected set of HTML tags, the rest will be stripped out automatically so we don't need to do it
  job.ele('description').dat(`${description}\n${crossoverJobCode}\n${hashTag}${remoteTag}<br />\n`);
}

function writeTypeLevel(job: XMLBuilder, campaign: LinkedInCampaign): void {
  const experienceLevel = LinkedInExperienceLevel[campaign.LI_Ad_Experience_Level__c];
  if (experienceLevel != null) {
    job.ele('experienceLevel').dat(experienceLevel);
  } else {
    // Not a mandatory field so we proceed but log an issue
    log.error(
      `[${campaign.Id} - ${campaign.InternalId__c}] Invalid experience level '${campaign.LI_Ad_Experience_Level__c}'`,
    );
  }

  const jobType = LinkedInJobType[campaign.Pipeline__r.Job_Type__c];
  if (jobType != null) {
    job.ele('jobtype').dat(jobType);
  } else {
    // Not a mandatory field so we proceed but log an issue
    log.error(`[${campaign.Id} - ${campaign.InternalId__c}] Invalid job type '${campaign.Pipeline__r.Job_Type__c}'`);
  }
}

function writeJobFunctions(job: XMLBuilder, campaign: LinkedInCampaign): void {
  const jobFunctions = job.ele('jobFunctions');
  const campaignJobFunctions = campaign.LI_Ad_Job_Functions__c?.split(';') || [];
  const uniqueValues = new Set<string>();
  campaignJobFunctions.forEach((it) => {
    const jobFunction = LinkedInJobFunctions[it];
    if (jobFunction != null) {
      uniqueValues.add(jobFunction);
    } else {
      // Not a mandatory field so we proceed but log an issue
      log.error(`[${campaign.Id} - ${campaign.InternalId__c}] Invalid job function '${it}'`);
    }
  });
  uniqueValues.forEach((it) => jobFunctions.ele('jobFunction').dat(it));
}

function writeIndustryCodes(job: XMLBuilder, campaign: LinkedInCampaign): void {
  const industryCodes = job.ele('industryCodes');
  const campaignIndustries = campaign.LI_Ad_Industries__c?.split(';') || [];
  const uniqueValues = new Set<string>();
  campaignIndustries.forEach((it) => {
    const industryCode = LinkedInIndustries[it];
    if (industryCode != null) {
      uniqueValues.add(industryCode);
    } else {
      // Not a mandatory field so we proceed but log an issue
      log.error(`[${campaign.Id} - ${campaign.InternalId__c}] Invalid industry '${it}'`);
    }
  });
  uniqueValues.forEach((it) => industryCodes.ele('industryCode').dat(it));
}

function writeSkills(job: XMLBuilder, campaign: LinkedInCampaign): void {
  if (campaign.LI_Ad_Skills__c != null) {
    // Skills are comma-separated
    const skills = campaign.LI_Ad_Skills__c.split(',').map((it) => it.trim());
    if (skills.length > 0) {
      const skillsElement = job.ele('skills');
      skills.forEach((skill) => {
        skillsElement.ele('skill').dat(skill);
      });
    }
  }
}

function writeUrls(job: XMLBuilder, campaign: LinkedInCampaign): void {
  // Application URL
  const medium = campaign.Type === 'LinkedIn Job Slots' ? 'jobslot' : 'free';
  const applicationUrl =
    `${campaign.Job_Board_Cell__r.Pipeline_Job_Title__r.Apply_URL__c}` +
    `?utm_source=linkedin&utm_medium=${encodeURIComponent(medium)}` +
    `&utm_campaign=${encodeURIComponent(campaign.InternalId__c)}`;

  job.ele('applyUrl').dat(applicationUrl);

  // This is not included into the reference manual, but we used to add it to indicate easy apply availability
  if (campaign.Ad_OneClick_Apply__c === 'Yes') {
    job.ele('easyapply');
  }
}

function writeSalaries(job: XMLBuilder, campaign: LinkedInCampaign): void {
  const hourlyRate = campaign.Pipeline__r.Hourly_Rate__c;
  const salaries = job.ele('salaries');
  const salary = salaries.ele('salary');

  const highEnd = salary.ele('highEnd');
  highEnd.ele('amount').dat(hourlyRate.toString());
  highEnd.ele('currencyCode').txt('USD');

  const lowEnd = salary.ele('lowEnd');
  lowEnd.ele('amount').dat(hourlyRate.toString());
  lowEnd.ele('currencyCode').txt('USD');

  salary.ele('period').dat('HOURLY');
  salary.ele('type').dat('BASE_SALARY');
}
