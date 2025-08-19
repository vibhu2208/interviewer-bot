import { defaultLogger } from '@trilogy-group/xoh-integration';
import * as crypto from 'crypto';
import { DateTime } from 'luxon';
import * as xmlbuilder from 'xmlbuilder';
import { Campaign } from './jobadx-data-service';

const logger = defaultLogger({ serviceName: 'jobadx-feed-builder' });
logger.setLogLevel('DEBUG');

export function buildJobAdXXmlFeed(
  campaigns: Campaign[],
  activePipelinesWithWorkLocations: Set<string>,
  countries: Record<string, string>,
) {
  logger.info('Building JobAdX XML feed...');

  const xml = xmlbuilder.create(
    'source',
    { version: '1.0', encoding: 'UTF-8' },
    {
      keepNullNodes: false,
      keepNullAttributes: false,
      headless: false,
      ignoreDecorators: false,
      separateArrayItems: false,
      noDoubleEncoding: true,
      noValidation: false,
      invalidCharReplacement: undefined,
      stringify: {},
    },
  );

  xml.e('publisher_name').t('Crossover');
  xml.e('publisher_url').t('https://www.crossover.com');
  xml.e('last_build_date').t(formatDateToRFC3339(new Date()));

  let successfulCampaigns = 0;
  let failedCampaigns = 0;
  campaigns.forEach((campaign) => {
    if (buildJobXml(xml, getJob(campaign, activePipelinesWithWorkLocations, countries))) {
      successfulCampaigns++;
    } else {
      failedCampaigns++;
    }
  });

  logger.info(
    `JobAdX XML feed is built. Successful records: ${successfulCampaigns}, failed records: ${failedCampaigns}`,
  );

  return xml.end({ pretty: true });
}

export interface Job {
  campaignId: string;
  campaignDisplayId: string;
  region: string;
  city: string;
  country: string;
  employer: string;
  jobType: string;
  salary: string;
  url: string;
  remoteType: string | undefined;
  description: string;
  requisitionId: string;
  targetLocation: string;
  organization: string;
  title: string;
  identifier: string;
  date: string;
  category: string;
  targetCpa: number;
}

export function getJob(
  campaign: Campaign,
  activePipelinesWithWorkLocations: Set<string>,
  countries: Record<string, string>,
): Job {
  const country = countries[campaign.Ad_Posted_Country_Name__c] ?? campaign.Ad_Posted_Country_Name__c;

  return {
    campaignId: campaign.Id,
    campaignDisplayId: `${campaign.Id} - ${campaign.InternalId__c}`,
    region: campaign.Job_Board_Cell__r.Location__r.State_Code__c ?? '',
    city: campaign.Ad_Posted_Location_Name__c ?? '',
    country,
    employer: campaign.Pipeline__r.Brand__r.Name ?? '',
    jobType: campaign.Pipeline__r.Job_Type__c === 'full-time' ? 'Full-Time' : 'Part-Time',
    salary: getSalaryTag(campaign),
    url: getUrl(campaign),
    remoteType: activePipelinesWithWorkLocations.has(campaign.Pipeline__c) ? undefined : 'WFH',
    description: campaign.Description,
    requisitionId: `PIPE_${campaign.Pipeline__r.ProductCode}`,
    targetLocation: getTargetLocation(
      campaign.Ad_Posted_Location_Name__c,
      campaign.Job_Board_Cell__r.Location__r.State_Code__c,
      country,
    ),
    organization: 'Crossover',
    title: campaign.Ad_Title__c,
    identifier: getIdentifier(campaign),
    date: formatDateToRFC3339(new Date(campaign.Pipeline__r.CreatedDate)),
    category: campaign.Pipeline__r.Family,
    targetCpa: campaign.Pipeline__r.Target_CPA__c,
  };
}

export function buildJobXml(xml: xmlbuilder.XMLElement, job: Job): boolean {
  try {
    const jobXml = xml.e('job');

    cdata('job_type', job.jobType);
    cdata('city', job.city);
    cdata('postal_code', '');
    cdata('salary', job.salary);
    cdata('target_location', job.targetLocation);
    cdata('employer', job.employer);
    cdata('industry', '');
    cdata('category', job.category);
    cdata('valid_through', '');
    cdata('experience', '');
    cdata('title', job.title, true);
    cdata('date', job.date, true);
    cdata('identifier', job.identifier, true);
    cdata('description', sanitizeHtml(job.description), true);
    cdata('bid', '');
    cdata('target_cpa', job.targetCpa ? `${job.targetCpa}` : '');
    cdata('organization', job.organization, true);
    cdata('url', job.url, true);
    cdata('region', job.region); // According to JobAdX docs, region is required, but we only have it set for some locations
    cdata('country', job.country, true);
    cdata('requisition_id', job.requisitionId);
    cdata('job_schedule_shift', '');
    cdata('remote_type', job.remoteType);
    cdata('requisition_details', '');
    cdata('business_unit_division', '');
    cdata('education', '');
    cdata('street_address', '');

    // eslint-disable-next-line no-inner-declarations
    function cdata(elementName: string, value: string | undefined, required = false) {
      if (value && value.trim().length > 0) {
        jobXml.e(elementName).d(value);
      } else if (required) {
        throw new Error(`${elementName} is required but not provided`);
      }
    }

    return true;
  } catch (e) {
    logger.error(`Cannot build job XML for campaign ${job.campaignDisplayId}`, { error: e });

    return false;
  }
}

/**
 * Formats the salary by applying precision and converting to comma separated format
 */
function getSalaryTag(campaign: Campaign): string {
  const symbol = '$';
  const salary = applyPrecision(campaign.Pipeline__r.Yearly_Rate__c, 4);
  const salaryString = salary.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); // Converting to comma separated format
  return `${symbol}${salaryString}`;
}

/**
 * Keep the most significant {precision} digits and round down the others
 */
function applyPrecision(input: number, precision: number) {
  const scale: number = 10 ** (Math.floor(Math.log10(input)) - precision + 1);
  return Math.trunc(input / scale) * scale;
}

/**
 * Formats the target location by joining the values with a comma if they are not empty
 */
function getTargetLocation(...values: string[]): string {
  return values.filter((x) => x && x.trim().length > 0).join(', ');
}

/**
 * Sanitize HTML by replacing special characters with their corresponding HTML entities
 */
function sanitizeHtml(html: string): string {
  return html ? html.replace(/&nbsp;/g, ' ') : '';
}

/**
 * Formats the date to RFC3339 format with space separators
 */
function formatDateToRFC3339(date: Date) {
  return DateTime.fromJSDate(date).toFormat('yyyy-MM-dd HH:mm:ss ZZZ');
}

function getUrl(campaign: Campaign): string {
  return `${campaign.Job_Board_Cell__r.Pipeline_Job_Title__r.Landing_Page_URL__c}?utm_campaign=${encodeURI(
    campaign.InternalId__c,
  )}`;
}

function getIdentifier(campaign: Campaign): string {
  return crypto
    .createHash('sha256')
    .update(`${campaign.Job_Board_Cell__r.Pipeline_Job_Title__c}-${campaign.Job_Board_Cell__r.Location__c}`)
    .digest('hex');
}
