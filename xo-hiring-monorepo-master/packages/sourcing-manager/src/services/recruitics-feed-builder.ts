import { XMLElement } from 'xmlbuilder';
import * as xmlbuilder from 'xmlbuilder';
import { Campaign, Config, Country, CurrencyConfig, SalaryTimeUnit } from './recruitics-data-service';

export function buildJobFeedXml(campaigns: Campaign[], countries: Country[], config: Config) {
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

  xml.ele('publisher').cdata('Crossover');
  xml.ele('publisherurl').cdata('https://www.crossover.com');
  xml.ele('lastBuildDate').cdata(new Date().toUTCString());

  campaigns.forEach((campaign) => buildJobXml(xml, campaign, countries, config));

  return xml.end({ pretty: true });
}

export function buildJobXml(xml: XMLElement, campaign: Campaign, countries: Country[], config: Config) {
  try {
    if (campaign.Ad_Title__c == null || campaign.Ad_Title__c.trim().length === 0) {
      console.error(`Ad_Title__c is empty for campaign ${campaign.Id} - ${campaign.InternalId__c}`);
      return;
    }

    if (campaign.Description == null || campaign.Description.trim().length === 0) {
      console.error(`Description is empty for campaign ${campaign.Id} - ${campaign.InternalId__c}`);
      return;
    }

    const { country, countryName, state, city } = getLocation(campaign, countries);
    const brandName = config.ListAllAdsUnderCrossover ? 'Crossover' : campaign.Pipeline__r.Brand__r.Name;
    const salary = getSalaryTag(campaign, config, country);
    const jobType = campaign.Pipeline__r.Job_Type__c === 'full-time' ? 'fulltime' : 'parttime';

    const job = xml.ele('job');
    job.ele('title').cdata(`${campaign.Ad_Title__c}`);
    job.ele('date').cdata(`${campaign.Pipeline__r.CreatedDate}`);
    job.ele('referencenumber').cdata(`${campaign.Name}`);
    job
      .ele('url')
      .cdata(
        `${campaign.Job_Board_Cell__r.Pipeline_Job_Title__r.Landing_Page_URL__c}?utm_campaign=${encodeURI(
          campaign.InternalId__c,
        )}`,
      );
    job.ele('company').cdata(`${brandName}`);
    job.ele('city').cdata(`${city}`);
    job.ele('state').cdata(`${state}`);
    job.ele('country').cdata(`${countryName}`);
    job.ele('description').cdata(prepareHtml(campaign.Description));
    job.ele('salary').cdata(`${salary}`);
    job.ele('jobtype').cdata(`${jobType}`);
    job.ele('category').cdata(`PIPE_${campaign.Pipeline__r.ProductCode}`);

    console.log(`Built job XML for campaign ${campaign.Id} - ${campaign.InternalId__c}`);
  } catch (e) {
    console.error(`Cannot build job XML for campaign ${campaign.Id} - ${campaign.InternalId__c}`, e);
  }
}

function getLocation(campaign: Campaign, countries: Country[]) {
  const country = campaign.Ad_Posted_Country_Name__c
    ? countries.find((item) => item.Label === campaign.Ad_Posted_Country_Name__c) ?? null
    : null;
  const state = campaign.Job_Board_Cell__r.Location__r.State_Code__c || '';
  const city = campaign.Ad_Posted_Location_Name__c || 'remote';
  const countryName = campaign.Ad_Posted_Country_Name__c;

  return { country, countryName, state, city };
}

function getSalaryTag(campaign: Campaign, config: Config, country: Country | null): string {
  let currency: string | null = 'USD';
  let exchangeRate = 1;
  let symbol: string | null = '$';
  let renderSymbol = config.Currency === CurrencyConfig.LocalSymbol || config.Currency === CurrencyConfig.USDSymbol;
  const localCurrency = country?.Currency__c ?? null;
  const localRate = country?.Exchange_Rate__c ?? null;
  const localSymbol = country?.Currency_Symbol__c ?? null;

  if (
    campaign.Ad_Posted_Country_Name__c &&
    config.Currency !== CurrencyConfig.USDCode &&
    config.Currency !== CurrencyConfig.USDSymbol
  ) {
    if (!localRate) {
      throw Error(`Exchange rate for ${campaign.Ad_Posted_Country_Name__c} is missing`);
    }
    // update only in case one is available (that means fallback to US/$ if both are missing)
    if (localCurrency || localSymbol) {
      currency = localCurrency;
      exchangeRate = localRate;
      symbol = localSymbol;
    }
    if (config.Currency === CurrencyConfig.LocalCode && !localCurrency) {
      renderSymbol = localSymbol ? true : false;
      console.warn(`localCurrency for ${campaign.Ad_Posted_Country_Name__c} is missing`);
    } else if (config.Currency === CurrencyConfig.LocalSymbol && !localSymbol) {
      renderSymbol = localCurrency ? false : true;
      console.warn(`LocalSymbol for ${campaign.Ad_Posted_Country_Name__c} is missing`);
    }
  }

  //get rounded down local salary based on exchangeRate
  const salaryInLocal: number = getLocalSalary(
    campaign.Pipeline__r.Monthly_Rate__c,
    campaign.Pipeline__r.Yearly_Rate__c,
    exchangeRate,
    config,
  );

  if (config.Currency === CurrencyConfig.LocalPlain) {
    return `${salaryInLocal} per ${config.SalaryTimeUnit}`;
  } else if (renderSymbol) {
    return `${symbol}${salaryInLocal} per ${config.SalaryTimeUnit}`;
  } else {
    return `${salaryInLocal} ${currency} per ${config.SalaryTimeUnit}`;
  }
}

function getLocalSalary(monthlyRate: number, yearlyRate: number, exchangeRate: number, config: Config): number {
  const MONTHLY_SALARY_PRECISION = 3;
  const YEARLY_SALARY_PRECISION = 4;

  let salaryInUSD = 0;
  if (config.SalaryTimeUnit === SalaryTimeUnit.Month) {
    salaryInUSD = monthlyRate;
  } else if (config.SalaryTimeUnit === SalaryTimeUnit.Year) {
    salaryInUSD = yearlyRate;
  }

  const salaryInLocal: number = salaryInUSD * exchangeRate;

  if (config.SalaryTimeUnit === SalaryTimeUnit.Month) {
    return toPrecision(salaryInLocal, MONTHLY_SALARY_PRECISION);
  } else if (config.SalaryTimeUnit === SalaryTimeUnit.Year) {
    return toPrecision(salaryInLocal, YEARLY_SALARY_PRECISION);
  }

  return Math.floor(salaryInLocal);
}

// keep the most significant {precision} digits and round down the others
function toPrecision(input: number, precision: number) {
  const scale: number = 10 ** (Math.floor(Math.log10(input)) - precision + 1);

  return Math.trunc(input / scale) * scale;
}

function prepareHtml(html: string): string {
  return html.replace(/&nbsp;/g, ' ');
}
