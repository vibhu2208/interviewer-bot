import {
  defaultLogger,
  SalesforceBulkUpdateEntity,
  SalesforceClient,
  SecretsManager,
} from '@trilogy-group/xoh-integration';
import { EventPayload } from '../handlers/indeed-feed-generator';
import { IndeedApiClient } from '../integrations/indeed';
import { chunkArray, groupBy } from '../utils/common';

const log = defaultLogger({ serviceName: 'indeed-data-service' });
log.setLogLevel('DEBUG');

const CountryRegionGrouping = new Map<string, string>([
  ['Chad', 'Africa'],
  ['Cuba', 'South America'],
  ['Fiji', 'Australia'],
  ['Iran', 'Asia'],
  ['Iraq', 'Asia'],
  ['Laos', 'Asia'],
  ['Mali', 'Africa'],
  ['Oman', 'Asia'],
  ['Peru', 'South America'],
  ['Togo', 'Africa'],
  ['Benin', 'Africa'],
  ['Chile', 'South America'],
  ['China', 'Asia'],
  ['Egypt', 'Africa'],
  ['Gabon', 'Africa'],
  ['Ghana', 'Africa'],
  ['Haiti', 'North America'],
  ['India', 'India'],
  ['Italy', 'Europe'],
  ['Japan', 'Asia'],
  ['Kenya', 'Africa'],
  ['Korea', 'Asia'],
  ['Libya', 'Africa'],
  ['Malta', 'Europe'],
  ['Nauru', 'Australia'],
  ['Nepal', 'Asia'],
  ['Niger', 'Africa'],
  ['Palau', 'Australia'],
  ['Qatar', 'Asia'],
  ['Samoa', 'Australia'],
  ['Spain', 'Europe'],
  ['Sudan', 'Africa'],
  ['Syria', 'Asia'],
  ['Tonga', 'Australia'],
  ['Yemen', 'Asia'],
  ['Angola', 'Africa'],
  ['Belize', 'North America'],
  ['Bhutan', 'Asia'],
  ['Brazil', 'South America'],
  ['Brunei', 'Asia'],
  ['Canada', 'North America'],
  ['Cyprus', 'Europe'],
  ['France', 'Europe'],
  ['Gambia', 'Africa'],
  ['Greece', 'Europe'],
  ['Guinea', 'Africa'],
  ['Guyana', 'South America'],
  ['Israel', 'Asia'],
  ['Jordan', 'Asia'],
  ['Kuwait', 'Asia'],
  ['Latvia', 'Europe'],
  ['Malawi', 'Africa'],
  ['Mexico', 'North America'],
  ['Monaco', 'Europe'],
  ['Norway', 'Europe'],
  ['Panama', 'North America'],
  ['Poland', 'Europe'],
  ['Rwanda', 'Africa'],
  ['Serbia', 'Europe'],
  ['Sweden', 'Europe'],
  ['Taiwan', 'Asia'],
  ['Turkey', 'Asia'],
  ['Tuvalu', 'Australia'],
  ['Uganda', 'Africa'],
  ['Zambia', 'Africa'],
  ['Albania', 'Europe'],
  ['Algeria', 'Africa'],
  ['Andorra', 'Europe'],
  ['Armenia', 'Asia'],
  ['Austria', 'Europe'],
  ['Bahamas', 'North America'],
  ['Bahrain', 'Asia'],
  ['Belarus', 'Europe'],
  ['Belgium', 'Europe'],
  ['Bermuda', 'North America'],
  ['Bolivia', 'South America'],
  ['Burundi', 'Africa'],
  ['Comoros', 'Africa'],
  ['Croatia', 'Europe'],
  ['Denmark', 'Europe'],
  ['Ecuador', 'South America'],
  ['Eritrea', 'Africa'],
  ['Estonia', 'Europe'],
  ['Finland', 'Europe'],
  ['Georgia', 'Asia'],
  ['Germany', 'Europe'],
  ['Grenada', 'North America'],
  ['Hungary', 'Europe'],
  ['Iceland', 'Europe'],
  ['Ireland', 'Europe'],
  ['Jamaica', 'North America'],
  ['Lebanon', 'Asia'],
  ['Lesotho', 'Africa'],
  ['Liberia', 'Africa'],
  ['Moldova', 'Europe'],
  ['Morocco', 'Africa'],
  ['Myanmar', 'Asia'],
  ['Namibia', 'Africa'],
  ['Nigeria', 'Africa'],
  ['Romania', 'Europe'],
  ['Senegal', 'Africa'],
  ['Somalia', 'Africa'],
  ['Tunisia', 'Africa'],
  ['Ukraine', 'Europe'],
  ['Uruguay', 'South America'],
  ['Vanuatu', 'Australia'],
  ['Vietnam', 'Asia'],
  ['Barbados', 'North America'],
  ['Botswana', 'Africa'],
  ['Bulgaria', 'Europe'],
  ['Cambodia', 'Asia'],
  ['Cameroon', 'Africa'],
  ['Colombia', 'South America'],
  ['Djibouti', 'Africa'],
  ['Dominica', 'North America'],
  ['Ethiopia', 'Africa'],
  ['Honduras', 'North America'],
  ['Kiribati', 'Australia'],
  ['Malaysia', 'Asia'],
  ['Maldives', 'Asia'],
  ['Mongolia', 'Asia'],
  ['Pakistan', 'Asia'],
  ['Paraguay', 'South America'],
  ['Portugal', 'Europe'],
  ['Slovakia', 'Europe'],
  ['Slovenia', 'Europe'],
  ['Suriname', 'South America'],
  ['Tanzania', 'Africa'],
  ['Thailand', 'Asia'],
  ['Zimbabwe', 'Africa'],
  ['Argentina', 'South America'],
  ['Australia', 'Australia'],
  ['Greenland', 'North America'],
  ['Guatemala', 'North America'],
  ['Hong Kong', 'Asia'],
  ['Indonesia', 'Asia'],
  ['Lithuania', 'Europe'],
  ['Macedonia', 'Europe'],
  ['Mauritius', 'Africa'],
  ['Nicaragua', 'North America'],
  ['Singapore', 'Asia'],
  ['Sri Lanka', 'Asia'],
  ['Swaziland', 'Africa'],
  ['Venezuela', 'South America'],
  ['Azerbaijan', 'Asia'],
  ['Bangladesh', 'Asia'],
  ['Cape Verde', 'Africa'],
  ['Costa Rica', 'North America'],
  ['Kazakhstan', 'Asia'],
  ['Kyrgyzstan', 'Asia'],
  ['Luxembourg', 'Europe'],
  ['Madagascar', 'Africa'],
  ['Mauritania', 'Africa'],
  ['Montenegro', 'Europe'],
  ['Mozambique', 'Africa'],
  ['San Marino', 'Europe'],
  ['Seychelles', 'Africa'],
  ['Tajikistan', 'Asia'],
  ['Uzbekistan', 'Asia'],
  ['Afghanistan', 'Asia'],
  ['Congo (DRC)', 'Africa'],
  ['El Salvador', 'North America'],
  ['Netherlands', 'Europe'],
  ['New Zealand', 'Australia'],
  ['Philippines', 'Asia'],
  ['Puerto Rico', 'North America'],
  ['Saint Lucia', 'North America'],
  ['South Korea', 'Asia'],
  ['South Sudan', 'Africa'],
  ['Switzerland', 'Europe'],
  ['Timor-Leste', 'Asia'],
  ['Burkina Faso', 'Africa'],
  ['Cook Islands', 'Australia'],
  ['Saudi Arabia', 'Asia'],
  ['Sierra Leone', 'Africa'],
  ['South Africa', 'Africa'],
  ['Turkmenistan', 'Asia'],
  ['Vatican City', 'Europe'],
  ["Cote D'Ivoire", 'Africa'],
  ['Faroe Islands', 'Europe'],
  ['Guinea-Bissau', 'Africa'],
  ['Liechtenstein', 'Europe'],
  ['United States', 'North America'],
  ['Czech Republic', 'Europe'],
  ['United Kingdom', 'Europe'],
  ['Slovak Republic', 'Europe'],
  ['Solomon Islands', 'Australia'],
  ['Marshall Islands', 'Australia'],
  ['Papua New Guinea', 'Australia'],
  ['Equatorial Guinea', 'Africa'],
  ['Dominican Republic', 'North America'],
  ['Russian Federation', 'Europe'],
  ['Antigua and Barbuda', 'North America'],
  ['Trinidad and Tobago', 'North America'],
  ['United Arab Emirates', 'Asia'],
  ['Republic of the Congo', 'Africa'],
  ['Saint Kitts and Nevis', 'North America'],
  ['Sao Tome and Principe', 'Africa'],
  ['Bosnia and Herzegovina', 'Europe'],
  ['Central African Republic', 'Africa'],
  ['Federated States of Micronesia', 'Australia'],
  ['Saint Vincent and the Grenadines', 'North America'],
]);

export class IndeedDataService {
  /**
   * Returns actual configuration taking into account event and default values.
   * @param event  lambda event containing values that allows to specify configuration parameters
   */
  static async getConfig(event: EventPayload): Promise<IndeedConfig> {
    // Validation
    if (
      event.Currency != null &&
      !Object.values(IndeedCurrencyConfig).includes(event.Currency as IndeedCurrencyConfig)
    ) {
      throw Error(
        `event.Currency has incorrect value "${event.Currency}", ` +
          `should be one of the following ${Object.keys(IndeedCurrencyConfig)}`,
      );
    }
    if (
      event.SalaryTimeUnit != null &&
      !Object.values(IndeedSalaryTimeUnit).includes(event.SalaryTimeUnit as IndeedSalaryTimeUnit)
    ) {
      throw Error(
        `event.SalaryTimeUnit has incorrect value "${event.SalaryTimeUnit}", ` +
          `should be one of the following ${Object.values(IndeedSalaryTimeUnit)}`,
      );
    }
    if (
      event.IndeedApplyResumeTag != null &&
      !Object.values(IndeedTagsValues).includes(event.IndeedApplyResumeTag as IndeedTagsValues)
    ) {
      throw Error(
        `event.IndeedApplyResumeTag has incorrect value "${event.IndeedApplyResumeTag}". ` +
          `It should be one of the following "${Object.values(IndeedTagsValues)}"`,
      );
    }

    const indeedSecrets = await IndeedApiClient.fetchIndeedSecrets();

    // Applying default values
    return {
      IndeedSecrets: indeedSecrets,
      Currency: (event.Currency as IndeedCurrencyConfig) ?? IndeedCurrencyConfig.USDSymbol,
      SalaryTimeUnit: (event.SalaryTimeUnit as IndeedSalaryTimeUnit) ?? IndeedSalaryTimeUnit.Year,
      ListAllAdsUnderCrossover: event.ListAllAdsUnderCrossover ?? false,
      PostCellAdsAsRemote: event.PostCellAdsAsRemote ?? true,
      PostCountryCellsAsRemote: event.PostCountryCellsAsRemote ?? true,
      UseTwoLetterCountryCode: event.UseTwoLetterCountryCode ?? true,
      EnableIndeedApply: event.EnableIndeedApply ?? false,
      IndeedApplyResumeTag: (event.IndeedApplyResumeTag as IndeedTagsValues) ?? IndeedTagsValues.Hidden,
    };
  }

  /**
   * Group campaigns into the indeed sponsoring campaigns according to the algorithm.
   * Every indeed sponsoring campaign should have at least 50 campaigns, at max 175 campaigns.
   *
   * The algorithm is the following:
   * 1. We group campaigns by Pipeline__r.ProductCode because we want to allocate budget for different pipelines separately.
   * 2. For every subgroup we first try to group campaigns by Job_Board_Cell__r.Location__r.Country_Division__c.
   *     - If we have less than MIN campaigns we abandon the grouping and move to the next step.
   *     - If we have more than MAX campaigns we split the group into smaller groups to maintain the size of the group between MIN and MAX.
   *     - For every campaign that is grouped we set Placement__c to json string '{ "level": "CountryDivision": "value": "<Country_Division__c>" }'
   * 3. For every subgroup we take campaigns that do not yet have Placement__c set and try to group them by Job_Board_Cell__r.Location__r.Country__c.
   *     - We apply the same grouping logic as above.
   * 4. For every subgroup we take campaigns that do not yet have Placement__c set and try to group them by Job_Board_Cell__r.Location__r.Global_Region__c.
   *     - We apply the same grouping logic as above.
   * 5. For every campaign that does not yet have Placement__c set we set Placement__c to json string '{ "level": "None": "value": "Discard" }'
   * @param campaigns list of campaigns to be grouped
   * @param config configuration object that allows to specify the minimum and maximum number of campaigns per sponsoring campaign
   */
  static determineCampaignPlacement(
    campaigns: IndeedCampaignEx[],
    config?: CampaignPlacementConfiguration,
  ): IndeedCampaignEx[] {
    const minCampaignsPerSponsoringCampaign = config?.campaignsPerSponsoringCampaign?.min ?? 50;
    const maxCampaignsPerSponsoringCampaign = config?.campaignsPerSponsoringCampaign?.max ?? 175;

    log.info(
      `Calculating campaign placement for ${campaigns.length} campaigns with min ${minCampaignsPerSponsoringCampaign} and max ${maxCampaignsPerSponsoringCampaign} thresholds`,
    );

    // Remove existing placement if needed - for example when re-using the same campaigns for many weeks
    if (config?.removeExistingPlacement) {
      campaigns.forEach((campaign) => {
        campaign.Placement__c = null;
      });
    } else {
      // Try to parse existing placement if present
      campaigns.forEach((campaign) => {
        if (campaign.Placement__c != null) {
          try {
            campaign.Placement = JSON.parse(campaign.Placement__c);
          } catch (e) {
            log.warn(`Failed to parse Placement__c for campaign ${campaign.Id}`);
          }
        }
      });
    }

    // Local function to find the most optimal chunk size
    // We want to split into equal-sized groups while maintaining the minimum and maximum group size
    function findChunkSize(totalElements: number): number {
      let divisor;
      // We should reach the optimal divisor in ~3-5 iterations, leaving 50 as a hard cap because why not
      for (divisor = 1; divisor <= 50; divisor++) {
        if (Math.ceil(totalElements / divisor) < minCampaignsPerSponsoringCampaign) {
          divisor = Math.max(1, divisor - 1);
          break;
        }
        if (divisor * minCampaignsPerSponsoringCampaign > maxCampaignsPerSponsoringCampaign) {
          break;
        }
      }
      return Math.ceil(totalElements / divisor);
    }

    // Local function to perform the level-based grouping, since the algorithm for every level is the same
    function processGroups(groups: Record<string, IndeedCampaignEx[]>, level: IndeedCampaignPlacementLevel) {
      for (const groupName in groups) {
        const group = groups[groupName];
        // Discard groups that are too small
        if (group.length < minCampaignsPerSponsoringCampaign) {
          log.debug(`Grouping ${group.length} campaigns from ${groupName} on level ${level} :: group is too small`);
          continue;
        }

        // If the group is too large, we split it into smaller
        if (group.length > maxCampaignsPerSponsoringCampaign) {
          const chunks = chunkArray(group, findChunkSize(group.length));
          chunks.forEach((chunk, idx) => {
            // If for some reason we have a chunk that is smaller than the minimum, we discard it
            if (chunk.length < minCampaignsPerSponsoringCampaign) {
              log.warn(
                `Discarding chunk ${idx + 1} of ${groupName} because it is too small (${chunk.length} campaigns)`,
              );
              return;
            }
            log.debug(
              `Grouping ${group.length} campaigns from ${groupName} on level ${level} :: split into ${chunk.length} chunks and assign placement`,
            );
            chunk.forEach((campaign) => {
              campaign.Placement = { level, value: `${groupName}_${idx + 1}` };
            });
          });
        } else {
          // If the group is within the limits, we just assign the placement
          log.debug(`Grouping ${group.length} campaigns from ${groupName} on level ${level} :: assign placement`);
          group.forEach((campaign) => {
            campaign.Placement = { level, value: groupName };
          });
        }
      }
    }

    const groupedByProductCode = groupBy(campaigns, (campaign) => campaign.Pipeline__r.ProductCode);
    for (const productGroup of Object.values(groupedByProductCode)) {
      log.debug(`Processing ${productGroup.length} campaigns for product ${productGroup[0].Pipeline__r.ProductCode}`);
      const countryDivisionGroups = groupBy(
        productGroup,
        (campaign) => campaign.Job_Board_Cell__r.Location__r.Country_Division__c,
      );
      processGroups(countryDivisionGroups, 'CountryDivision');

      const remainingCampaigns = productGroup.filter((campaign) => campaign.Placement == null);
      const countryGroups = groupBy(
        remainingCampaigns,
        (campaign) => campaign.Job_Board_Cell__r.Location__r.Country__c,
      );
      processGroups(countryGroups, 'Country');

      const remainingCampaignsAfterCountry = remainingCampaigns.filter((campaign) => campaign.Placement == null);
      const globalRegionGroups = groupBy(
        remainingCampaignsAfterCountry,
        (campaign) => campaign.Job_Board_Cell__r.Location__r.Global_Region__c,
      );
      processGroups(globalRegionGroups, 'GlobalRegion');

      const remainingCampaignsAfterGlobalRegion = remainingCampaigns.filter((campaign) => campaign.Placement == null);
      if (remainingCampaignsAfterGlobalRegion.length > 0) {
        log.info(`Discarding ${remainingCampaignsAfterGlobalRegion.length} campaigns`);
      }
    }

    const noPlacementCampaigns = campaigns.filter((campaign) => campaign.Placement == null);
    noPlacementCampaigns.forEach((campaign) => (campaign.Placement = { level: 'None', value: 'Discard' }));

    log.info(`Discarded ${noPlacementCampaigns.length} campaigns`);

    // Update Placement__c field
    campaigns.forEach((campaign) => {
      campaign.Placement__c = campaign.Placement != null ? JSON.stringify(campaign.Placement) : null;
    });

    return campaigns;
  }

  /**
   * Group campaigns by region. This method will overwrite the existing placement.
   * @param campaigns
   */
  static groupCampaignsByRegion(campaigns: IndeedCampaignEx[]): IndeedCampaignEx[] {
    log.info(`Calculating campaign placement for ${campaigns.length} campaigns`);

    // Remove existing placement if present
    campaigns.forEach((campaign) => {
      campaign.Placement__c = null;
    });

    const groupedByProductCode = groupBy(campaigns, (campaign) => campaign.Pipeline__r.ProductCode);
    for (const productGroup of Object.values(groupedByProductCode)) {
      log.debug(`Processing ${productGroup.length} campaigns for product ${productGroup[0].Pipeline__r.ProductCode}`);
      const regionGroups = groupBy(productGroup, (campaign) => {
        const region = CountryRegionGrouping.get(campaign.Job_Board_Cell__r.Location__r.Country__c);
        if (region == null) {
          throw new Error(`No region found for country ${campaign.Job_Board_Cell__r.Location__r.Country__c}`);
        }
        return region;
      });
      for (const regionName in regionGroups) {
        const group = regionGroups[regionName];
        group.forEach((campaign) => {
          campaign.Placement = {
            level: 'GlobalRegion',
            value: regionName,
          };
          campaign.Placement__c = JSON.stringify(campaign.Placement);
        });
      }
    }

    return campaigns;
  }

  /**
   * Group campaigns by region. This method will overwrite the existing placement.
   * @param campaigns
   */
  static groupCampaignsByGlobalRegion(campaigns: IndeedCampaignEx[]): IndeedCampaignEx[] {
    log.info(`Calculating campaign placement for ${campaigns.length} campaigns`);

    // Remove existing placement if present
    campaigns.forEach((campaign) => {
      campaign.Placement__c = null;
    });

    const groupedByProductCode = groupBy(campaigns, (campaign) => campaign.Pipeline__r.ProductCode);
    for (const productGroup of Object.values(groupedByProductCode)) {
      log.debug(`Processing ${productGroup.length} campaigns for product ${productGroup[0].Pipeline__r.ProductCode}`);
      const globalRegionGroups = groupBy(
        productGroup,
        (campaign) => campaign.Job_Board_Cell__r.Location__r.Global_Region__c,
      );
      for (const globalRegion in globalRegionGroups) {
        const group = globalRegionGroups[globalRegion];
        group.forEach((campaign) => {
          campaign.Placement = {
            level: 'GlobalRegion',
            value: globalRegion,
          };
          campaign.Placement__c = JSON.stringify(campaign.Placement);
        });
      }
    }

    return campaigns;
  }

  static async fetchActiveTitlesForPipelines(sf: SalesforceClient): Promise<Record<string, string[]>> {
    const query = `
        SELECT Pipeline__r.ProductCode, Job_Title__c
        FROM Pipeline_Job_Title__c
        WHERE Is_Active__c = TRUE
  `;
    let results = await sf.querySOQL<{ Pipeline__r: { ProductCode: string }; Job_Title__c: string }>(query);
    results = results.filter((result) => result.Pipeline__r?.ProductCode != null);

    return results.reduce((acc, result) => {
      if (!acc[result.Pipeline__r.ProductCode]) {
        acc[result.Pipeline__r.ProductCode] = [];
      }
      acc[result.Pipeline__r.ProductCode].push(result.Job_Title__c);
      return acc;
    }, {} as Record<string, string[]>);
  }

  /**
   * Group campaigns by country. This method will overwrite the existing placement.
   * @param campaigns
   */
  static groupCampaignsByCountry(campaigns: IndeedCampaignEx[]): IndeedCampaignEx[] {
    log.info(`Calculating campaign placement for ${campaigns.length} campaigns`);

    // Remove existing placement if present
    campaigns.forEach((campaign) => {
      campaign.Placement__c = null;
    });

    const groupedByProductCode = groupBy(campaigns, (campaign) => campaign.Pipeline__r.ProductCode);
    for (const productGroup of Object.values(groupedByProductCode)) {
      log.debug(`Processing ${productGroup.length} campaigns for product ${productGroup[0].Pipeline__r.ProductCode}`);
      const countryGroups = groupBy(productGroup, (campaign) => campaign.Job_Board_Cell__r.Location__r.Country__c);
      for (const countryName in countryGroups) {
        const group = countryGroups[countryName];
        group.forEach((campaign) => {
          campaign.Placement = {
            level: 'Country',
            value: countryName,
          };
          campaign.Placement__c = JSON.stringify(campaign.Placement);
        });
      }
    }

    return campaigns;
  }

  /**
   * Generate campaign category tag based on the campaign configuration. This tag will be used by indeed sponsoring campaigns.
   * Does not overwrite the existing tag. Expected to be called after the campaign placement is determined.
   * @param campaigns
   */
  static generateCampaignCategoryTag(campaigns: IndeedCampaignEx[]): void {
    const campaignsToGenerateTagFor = campaigns
      .filter((campaign) => campaign.CategoryTag == null) // Do not generate for those with tag already
      .filter((campaign) => campaign.Placement != null) // Do not generate for those without placement
      .filter((campaign) => campaign.Placement?.level !== 'None'); // Do not generate for discarded campaigns

    // We want to re-use tags as much as possible to avoid pollution, so we will maintain flat index-based naming
    const groupedByProductCode = groupBy(campaignsToGenerateTagFor, (campaign) => campaign.Pipeline__r.ProductCode);
    for (const productCode in groupedByProductCode) {
      const campaignsForProductCode = groupedByProductCode[productCode];
      const groupedByPlacement = groupBy(campaignsForProductCode, (campaign) => campaign.Placement__c);
      log.info(`Pipeline ${productCode} has ${Object.keys(groupedByPlacement).length} different placement groups`);
      Object.values(groupedByPlacement).forEach((group, idx) => {
        group.forEach((campaign) => {
          campaign.CategoryTag = `I2_PIPE_${productCode}_${campaign.Placement?.value ?? idx + 1}`;

          // Update the Placement__c field as well to keep track of the allocated category tag
          if (campaign.Placement != null) {
            campaign.Placement.tag = campaign.CategoryTag;
            campaign.Placement__c = JSON.stringify(campaign.Placement);
          }
        });
      });
    }
  }

  /**
   * Update campaign placement field in Salesforce
   * @param sf
   * @param campaigns
   */
  static async updateCampaignPlacement(sf: SalesforceClient, campaigns: IndeedCampaignEx[]): Promise<void> {
    const bulkUpdateRecords: SalesforceBulkUpdateEntity[] = campaigns.map((campaign) => ({
      attributes: { type: 'Campaign' },
      id: campaign.Id,
      Placement__c: campaign.Placement__c,
    }));

    const results = await sf.bulkUpdateObjects(bulkUpdateRecords);
    const failedResults = results.filter((result) => !result.success);
    log.info(`Updated ${results.length - failedResults.length} campaigns, failed to update ${failedResults.length}`);
  }

  static async fetchCountries(sf: SalesforceClient): Promise<IndeedCountry[]> {
    return await sf.querySOQL<IndeedCountry>(`
      SELECT 
          Code__c, 
          Label, 
          Currency__c, 
          Exchange_Rate__c, 
          Currency_Symbol__c 
      FROM Country__mdt
  `);
  }

  static async fetchCampaigns(sf: SalesforceClient): Promise<IndeedCampaign[]> {
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
          Placement__c,
          Job_Board_Cell__r.Location__c,
          Job_Board_Cell__r.Location__r.Is_Country__c,
          Job_Board_Cell__r.Location__r.Country_Division__c,
          Job_Board_Cell__r.Location__r.Global_Region__c,
          Job_Board_Cell__r.Location__r.Country__c,
          Job_Board_Cell__r.Pipeline_Job_Title__r.Landing_Page_URL__c,
          Job_Board_Cell__r.Pipeline_Job_Title__r.Apply_URL__c,
          Pipeline__r.Hourly_Rate__c,
          Pipeline__r.Yearly_Rate__c,
          Pipeline__r.Monthly_Rate__c,
          Pipeline__r.Job_Type__c,
          Pipeline__r.Hours_per_Week__c,
          Pipeline__r.Family,
          Pipeline__r.Sourcing_World_Map__c
      FROM Campaign
      WHERE RecordType.DeveloperName = 'Indeed_Job'
          AND Status IN ('In Progress', 'Planned')
          AND Job_Board_Cell__c != NULL
  `;
    return await sf.querySOQL<IndeedCampaign>(query);
  }

  /**
   * Fetch additional analytics information for the campaigns.
   * Note: This method returns current state of the job board cell analytics, not the historical one.
   * @param sf
   * @param campaigns
   * @param batchSize
   */
  static async addAnalyticsInformation(
    sf: SalesforceClient,
    campaigns: IndeedCampaignEx[],
    batchSize = 200,
  ): Promise<IndeedCampaignEx[]> {
    const cellAnalyticsMap = new Map<
      string,
      {
        Publish_Selection__c: string;
        MiningRank__c: number;
      }
    >();
    const locationAnalyticsMap = new Map<
      string,
      {
        Conversion_Rank__c: number;
        Exploration_Rank__c: number;
      }
    >();

    // Group by pipeline and batch process
    const groupedByPipeline = groupBy(campaigns, (campaign) => campaign.Pipeline__r.ProductCode);
    for (const productCode in groupedByPipeline) {
      const pipelineCampaigns = groupedByPipeline[productCode];

      // Process campaigns in batches
      for (let i = 0; i < pipelineCampaigns.length; i += batchSize) {
        const batchCampaigns = pipelineCampaigns.slice(i, i + batchSize);
        const cellIds = batchCampaigns.map((campaign) => `'${campaign.Job_Board_Cell__c}'`).join(',');

        const cellAnalytics = await sf.querySOQL<{
          Id: string;
          Publish_Selection__c: string;
          Job_Board_Cell__c: string;
          MiningRank__c: number;
        }>(
          `
              SELECT Id,
                     Publish_Selection__c,
                     Job_Board_Cell__c,
                     MiningRank__c
              FROM Job_Board_Cell_Analytics__c
              WHERE Sourcing_Platform__c = 'Indeed'
                AND Job_Board_Cell__c IN (${cellIds})
          `,
        );

        // Add cell analytics to the map
        cellAnalytics.forEach((cell) => {
          cellAnalyticsMap.set(cell.Job_Board_Cell__c, {
            Publish_Selection__c: cell.Publish_Selection__c,
            MiningRank__c: cell.MiningRank__c,
          });
        });

        // Fetch location analytics
        const worldMapId = pipelineCampaigns[0].Pipeline__r.Sourcing_World_Map__c;

        const locationIds = batchCampaigns.map((campaign) => `'${campaign.Job_Board_Cell__r.Location__c}'`).join(',');
        const worldMapLocations = await sf.querySOQL<{
          Location__c: string;
          Conversion_Rank__c: number;
          Exploration_Rank__c: number;
        }>(`
            SELECT Location__c,
                   Conversion_Rank__c,
                   Exploration_Rank__c
            FROM World_Map_Location__c
            WHERE World_Map__c = '${worldMapId}'
              AND Location__c IN (${locationIds})`);

        worldMapLocations.forEach((location) => {
          locationAnalyticsMap.set(location.Location__c, {
            Conversion_Rank__c: location.Conversion_Rank__c,
            Exploration_Rank__c: location.Exploration_Rank__c,
          });
        });
      }
    }

    // Add cell analytics information to campaigns
    campaigns.forEach((campaign) => {
      const cellAnalytics = cellAnalyticsMap.get(campaign.Job_Board_Cell__c);
      const locationAnalytics = locationAnalyticsMap.get(campaign.Job_Board_Cell__r.Location__c);
      campaign.Analytics = {
        Publish_Selection__c: cellAnalytics?.Publish_Selection__c ?? 'Unknown',
        MiningRank__c: cellAnalytics?.MiningRank__c ?? -1,
        Conversion_Rank__c: locationAnalytics?.Conversion_Rank__c ?? -1,
        Exploration_Rank__c: locationAnalytics?.Exploration_Rank__c ?? -1,
      };
    });

    return campaigns;
  }
}

export interface IndeedConfig {
  IndeedSecrets: IndeedSecrets;
  Currency: IndeedCurrencyConfig;
  SalaryTimeUnit: IndeedSalaryTimeUnit;
  ListAllAdsUnderCrossover: boolean;
  PostCellAdsAsRemote: boolean;
  PostCountryCellsAsRemote: boolean;
  UseTwoLetterCountryCode: boolean;
  EnableIndeedApply: boolean;
  IndeedApplyResumeTag: IndeedTagsValues;
}

export interface IndeedSecrets {
  /**
   * Indeed Apply Client Id
   */
  indeedClientId: string;
  /**
   * Indeed Apply Client Secret
   */
  indeedClientSecret: string;
  /**
   * Indeed Apply Endpoint URL
   */
  indeedPostUrl: string;
  /**
   * Indeed Apply Questions URL
   */
  indeedQuestionsUrl: string;
  /**
   * Internal GQL Api Access: Extract from the header in Browser
   */
  internalApiKey: string;
  /**
   * Internal GQL Api Access: Extract from Cookies (SOCK) in Browser
   */
  internalCookieSock: string;
  /**
   * Internal GQL Api Access: Extract from Cookies (SHOE) in Browser
   */
  internalCookieShoe: string;
  /**
   * Disposition API Client Id
   */
  dispositionApiClientId: string;
  /**
   * Disposition API Client Secret
   */
  dispositionApiClientSecret: string;
}

export enum IndeedCurrencyConfig {
  USDCode = 'USDCode',
  USDSymbol = 'USDSymbol',
  LocalCode = 'LocalCode',
  LocalSymbol = 'LocalSymbol',
  LocalPlain = 'LocalPlain',
}

export enum IndeedSalaryTimeUnit {
  Year = 'year',
  Month = 'month',
  Hour = 'hour',
}

export enum IndeedTagsValues {
  Optional = 'optional',
  Required = 'required',
  Hidden = 'hidden',
}

export interface IndeedCountry {
  Code__c: string;
  Label: string;
  Currency__c: string;
  Exchange_Rate__c: number;
  Currency_Symbol__c: string;
}

export interface IndeedCampaign {
  Id: string;
  Name: string;
  Type: string;
  InternalId__c: string;
  Ad_Title__c: string;
  Description: string;
  Ad_Posted_Country_Name__c: string;
  Ad_Posted_Location_Name__c: string | null;
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
    Family: string;
    Sourcing_World_Map__c: string;
  };
  Job_Board_Cell__c: string;
  Job_Board_Cell__r: {
    Location__r: {
      Is_Country__c: boolean;
      Country_Division__c: string | null;
      Global_Region__c: string;
      Country__c: string;
    };
    Location__c: string;
    Pipeline_Job_Title__r: {
      Landing_Page_URL__c: string;
      Apply_URL__c: string;
    };
  };
  Placement__c: string | null;

  // Not present on the response but can be filled via addAnalyticsInformation call
  Analytics?: {
    Publish_Selection__c: string;
    MiningRank__c: number;
    Conversion_Rank__c: number;
    Exploration_Rank__c: number;
  };
}

/**
 * Extended type that includes fields calculated during the runtime
 */
export interface IndeedCampaignEx extends IndeedCampaign {
  /**
   * Category tag that is used to group campaigns into the same sponsoring campaign
   */
  CategoryTag?: string;

  /**
   * Campaign placement configuration
   */
  Placement?: IndeedCampaignPlacementObject;

  /**
   * Internal field just for tests, not present in the real data
   */
  ExpectedPlacement?: IndeedCampaignPlacementObject;
}

export type IndeedCampaignPlacementLevel = 'None' | 'CountryDivision' | 'Country' | 'GlobalRegion';

export interface IndeedCampaignPlacementObject {
  level: IndeedCampaignPlacementLevel;
  value: string;
  tag?: string;
}

export interface CampaignPlacementConfiguration {
  removeExistingPlacement?: boolean;
  campaignsPerSponsoringCampaign: {
    min: number;
    max: number;
  };
}
