import { defaultLogger, Salesforce, SalesforceIntegrationLogger } from '@trilogy-group/xoh-integration';
import { XMLElement } from 'xmlbuilder';
import * as xmlbuilder from 'xmlbuilder';
import { FeedUploadService } from '../services/feed-upload-service';
import {
  IndeedCampaign,
  IndeedCountry,
  IndeedConfig,
  IndeedCurrencyConfig,
  IndeedDataService,
  IndeedSalaryTimeUnit,
  IndeedTagsValues,
  IndeedCampaignEx,
} from '../services/indeed-data-service';

const log = defaultLogger({ serviceName: 'indeed-feed-generator' });
SalesforceIntegrationLogger.setLogLevel('WARN');

/**
 * Optional lambda input payload.
 */
export interface EventPayload {
  Currency?: string;
  SalaryTimeUnit?: string;
  ListAllAdsUnderCrossover?: boolean;
  PostCellAdsAsRemote?: boolean;
  PostCountryCellsAsRemote?: boolean;
  UseTwoLetterCountryCode?: boolean;
  EnableIndeedApply?: boolean;
  IndeedApplyResumeTag?: string;
}

export const DefaultPayload: Required<EventPayload> = {
  Currency: 'LocalCode',
  SalaryTimeUnit: 'month',
  ListAllAdsUnderCrossover: true,
  PostCellAdsAsRemote: false,
  PostCountryCellsAsRemote: true,
  UseTwoLetterCountryCode: false,
  EnableIndeedApply: true,
  IndeedApplyResumeTag: 'hidden',
};

/**
 * Indeed feed generator lambda handler.
 * @param event lambda event containing values that allows to specify configuration parameters
 */
export async function handler(event: EventPayload = DefaultPayload): Promise<void> {
  const config = await IndeedDataService.getConfig(event);

  log.info('Loading data from salesforce...');
  const sf = await Salesforce.getAdminClient();
  const countries = await IndeedDataService.fetchCountries(sf);
  const campaigns: IndeedCampaignEx[] = await IndeedDataService.fetchCampaigns(sf);
  await IndeedDataService.addAnalyticsInformation(sf, campaigns);
  log.info(`Loaded ${countries.length} countries and ${campaigns.length} campaigns`);

  const activeTitles = await IndeedDataService.fetchActiveTitlesForPipelines(sf);

  log.info('Determining campaign placement...');
  IndeedDataService.groupCampaignsByGlobalRegion(campaigns);

  log.info('Generating category tags...');
  IndeedDataService.generateCampaignCategoryTag(campaigns);

  const campaignsWithTag = campaigns.filter((campaign) => campaign.CategoryTag != null);
  log.info(`Building XML for the ${campaignsWithTag.length} remaining campaigns with category tags`);
  const xmlFeed = buildIndeedJobFeedXml(campaignsWithTag, countries, config, activeTitles);

  if (process.env.DRY_RUN !== 'true') {
    await FeedUploadService.uploadXMLToS3Bucket('indeed/indeed-jobs-feed.xml', xmlFeed);
    if (process.env.LEGACY_OUTPUT_BUCKET_NAME != null) {
      log.info(`Detected legacy bucket name, saving output file for the old path`);
      await FeedUploadService.uploadXMLToS3Bucket(
        'indeed-job-wrapping.xml',
        xmlFeed,
        process.env.LEGACY_OUTPUT_BUCKET_NAME,
      );
    }

    log.info(`Updating placement in Salesforce for ${campaigns.length} campaigns...`);
    await IndeedDataService.updateCampaignPlacement(sf, campaigns);
  }
}

export function buildIndeedJobFeedXml(
  campaigns: IndeedCampaign[],
  countries: IndeedCountry[],
  config: IndeedConfig,
  activeTitles: Record<string, string[]>,
): string {
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
      noValidation: true,
      invalidCharReplacement: undefined,
      stringify: {},
    },
  );
  xml.ele('publisher', 'Crossover');
  xml.ele('publisherurl', 'https://www.crossover.com');

  campaigns.forEach((campaign) => {
    buildJobXml(xml, campaign, countries, config, activeTitles);
  });

  return xml.end({ pretty: true });
}

function buildJobXml(
  xml: XMLElement,
  campaign: IndeedCampaignEx,
  countries: IndeedCountry[],
  config: IndeedConfig,
  activeTitles: Record<string, string[]>,
): void {
  try {
    if (campaign.CategoryTag == null) {
      log.error(`CategoryTag is missing for campaign ${campaign.Id} - ${campaign.InternalId__c}`);
      return;
    }
    if (campaign.Ad_Title__c == null || campaign.Ad_Title__c.trim().length === 0) {
      log.error(`Ad_Title__c is empty for campaign ${campaign.Id} - ${campaign.InternalId__c}`);
      return;
    }
    if (campaign.Description == null || campaign.Description.trim().length === 0) {
      log.error(`Description is empty for campaign ${campaign.Id} - ${campaign.InternalId__c}`);
      return;
    }
    const country = campaign.Ad_Posted_Country_Name__c
      ? countries.find((item) => item.Label === campaign.Ad_Posted_Country_Name__c) ?? null
      : null;
    const countryCode = country?.Code__c ?? '';
    const state = campaign.Ad_Posted_Location_Name__c ? countryCode : 'remote';
    const city = campaign.Ad_Posted_Location_Name__c || 'remote';
    const countryName =
      config.UseTwoLetterCountryCode || !campaign.Ad_Posted_Country_Name__c
        ? countryCode
        : campaign.Ad_Posted_Country_Name__c;
    const isCountry = campaign.Job_Board_Cell__r.Location__r.Is_Country__c;

    const job = xml.ele('job');
    job.ele('title').cdata(`${campaign.Ad_Title__c}`);
    job.ele('date').cdata(`${campaign.Pipeline__r.CreatedDate}`);
    job.ele('referencenumber').cdata(`${campaign.Name}`);
    job.ele('requisitionid').cdata(`${campaign.Name}`);
    const utm = `?utm_source=indeed&utm_medium=${encodeURI('free')}&utm_campaign=${encodeURI(campaign.InternalId__c)}`;

    const url = campaign.Job_Board_Cell__r.Pipeline_Job_Title__r.Landing_Page_URL__c;
    job.ele('url').cdata(`${url}${utm}`);

    const applyurl = campaign.Job_Board_Cell__r.Pipeline_Job_Title__r.Apply_URL__c;
    job.ele('applyurl').cdata(`${applyurl}${utm}`);

    const salary = getSalaryTag(campaign, config, country);
    job.ele('salary').cdata(`${salary}`);

    const brandName = config.ListAllAdsUnderCrossover ? 'Crossover' : campaign.Pipeline__r.Brand__r.Name;
    job.ele('company').cdata(`${brandName}`);
    job.ele('sourcename').cdata(`Crossover`);
    job.ele('city').cdata(`${city}`);
    job.ele('state').cdata(`${state}`);
    job.ele('country').cdata(`${countryName}`);
    job.ele('contact').cdata('Dragos Nuta');
    job.ele('email').cdata('dragos.nuta@crossover.com');

    const otherTitles: string[] = (activeTitles[campaign.Pipeline__r.ProductCode] || []).filter(
      (title) => !campaign.Ad_Title__c.includes(title),
    );
    let otherTitlesStr = '';
    if (otherTitles.length > 0) {
      otherTitlesStr = `<p><strong>This position is also known as:</strong></p><ul>\n`;
      otherTitles.forEach((title) => {
        otherTitlesStr += `  <li>${title}</li>`;
      });
      otherTitlesStr += `</ul>`;
    }

    job.ele('description').cdata(prepareHtml(campaign.Description + otherTitlesStr));
    const jobType = campaign.Pipeline__r.Job_Type__c === 'full-time' ? 'fulltime' : 'parttime';
    job.ele('jobtype').cdata(`${jobType}`);
    job.ele('category').cdata(campaign.CategoryTag);
    const allowPostingAsRemote =
      (!isCountry && config.PostCellAdsAsRemote) || (isCountry && config.PostCountryCellsAsRemote);
    if (allowPostingAsRemote && campaign.Pipeline__r.Geographic_Restriction__c !== 'City') {
      job.ele('remotetype').cdata(`Fully remote`);
    }

    if (config.EnableIndeedApply) {
      const locationParts = [countryName];
      if (state !== 'remote') {
        locationParts.push(state);
      }
      if (city !== 'remote') {
        locationParts.push(city);
      }
      const location = locationParts.join(' / ');
      job.ele('indeed-apply-data').cdata(getIndeedApplyDataTag(campaign, brandName, location, config, `${url}${utm}`));
    }
  } catch (e) {
    log.error(`Cannot build job XML for campaign ${campaign.Id} - ${campaign.InternalId__c}`, e as Error);
  }
}

/**
 * Generated Indeed apply parameter/value pairs query string.
 * @param campaign
 * @param brandName
 * @param location
 * @param config current job feed configuration
 * @param jobUrl
 */
export function getIndeedApplyDataTag(
  campaign: IndeedCampaign,
  brandName: string,
  location: string,
  config: IndeedConfig,
  jobUrl: string,
): string {
  let tag = '';
  // add api token
  tag += 'indeed-apply-apiToken=' + config.IndeedSecrets.indeedClientId;
  // add resume config
  tag += '&indeed-apply-resume=' + config.IndeedApplyResumeTag;
  // add cover letter config
  tag += '&indeed-apply-coverletter=' + IndeedTagsValues.Hidden;
  // add title
  tag += '&indeed-apply-jobTitle=' + encodeURIComponent(campaign.Ad_Title__c).replace(/%20/g, '+');
  // add company name
  tag += '&indeed-apply-jobCompanyName=' + encodeURIComponent(brandName).replace(/%20/g, '+');
  // add location
  tag += '&indeed-apply-jobLocation=' + encodeURIComponent(location).replace(/%20/g, '+');
  // add jobId
  tag += '&indeed-apply-jobId=' + encodeURIComponent(campaign.InternalId__c).replace(/%20/g, '+');
  // add name
  tag += '&indeed-apply-name=firstlastname';
  // add screening questions
  tag += '&indeed-apply-questions=' + encodeURIComponent(config.IndeedSecrets.indeedQuestionsUrl);
  // add post url
  tag += '&indeed-apply-postUrl=' + encodeURIComponent(config.IndeedSecrets.indeedPostUrl);
  // job url
  tag += '&indeed-apply-jobUrl=' + encodeURIComponent(jobUrl);

  return tag;
}

function getSalaryTag(campaign: IndeedCampaign, config: IndeedConfig, country: IndeedCountry | null): string {
  let currency: string | null = 'USD';
  let exchangeRate = 1;
  let symbol: string | null = '$';
  let renderSymbol =
    config.Currency === IndeedCurrencyConfig.LocalSymbol || config.Currency === IndeedCurrencyConfig.USDSymbol;
  const localCurrency = country?.Currency__c ?? null;
  const localRate = country?.Exchange_Rate__c ?? null;
  const localSymbol = country?.Currency_Symbol__c ?? null;

  if (
    campaign.Ad_Posted_Country_Name__c &&
    config.Currency !== IndeedCurrencyConfig.USDCode &&
    config.Currency !== IndeedCurrencyConfig.USDSymbol
  ) {
    if (!localRate) {
      throw Error(`Exchange rate for ${campaign.Ad_Posted_Country_Name__c} is missing`);
    }
    // update only in case one is avaliable (that's mean fallback to US/$ if both are missing)
    if (localCurrency || localSymbol) {
      currency = localCurrency;
      exchangeRate = localRate;
      symbol = localSymbol;
    }
    if (config.Currency === IndeedCurrencyConfig.LocalCode && !localCurrency) {
      renderSymbol = localSymbol ? true : false;
      log.warn(`localCurrency for ${campaign.Ad_Posted_Country_Name__c} is missing`);
    } else if (config.Currency === IndeedCurrencyConfig.LocalSymbol && !localSymbol) {
      renderSymbol = localCurrency ? false : true;
      log.warn(`LocalSymbol for ${campaign.Ad_Posted_Country_Name__c} is missing`);
    }
  }

  //get rounded down local salary based on exchangeRate
  const salaryInLocal: number = getLocalSalary(
    campaign.Pipeline__r.Monthly_Rate__c,
    campaign.Pipeline__r.Yearly_Rate__c,
    campaign.Pipeline__r.Hourly_Rate__c,
    exchangeRate,
    config,
  );

  if (config.Currency === IndeedCurrencyConfig.LocalPlain) {
    return `${salaryInLocal} per ${config.SalaryTimeUnit}`;
  } else if (renderSymbol) {
    return `${symbol}${salaryInLocal} per ${config.SalaryTimeUnit}`;
  } else {
    return `${salaryInLocal} ${currency} per ${config.SalaryTimeUnit}`;
  }
}

function getLocalSalary(
  monthlyRate: number,
  yearlyRate: number,
  hourlyRate: number,
  exchangeRate: number,
  config: IndeedConfig,
): number {
  switch (config.SalaryTimeUnit) {
    case IndeedSalaryTimeUnit.Month:
      return toPrecision(monthlyRate * exchangeRate, 3);
    case IndeedSalaryTimeUnit.Year:
      return toPrecision(yearlyRate * exchangeRate, 4);
    case IndeedSalaryTimeUnit.Hour:
      return Math.floor(hourlyRate * exchangeRate);
  }
}

// keep the most significant {precision} digits and round down the others
function toPrecision(input: number, precision: number) {
  const scale: number = 10 ** (Math.floor(Math.log10(input)) - precision + 1);

  return Math.trunc(input / scale) * scale;
}

function prepareHtml(html: string): string {
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, `'`);
}
