import 'dotenv/config';
import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';
import { DateTime } from 'luxon';
import { stringify } from 'csv-stringify/sync';
import table from 'text-table';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ConvertedPerformance, IndeedApiClient } from '../integrations/indeed';
import { IndeedCampaignEx, IndeedDataService } from '../services/indeed-data-service';
import { groupBy } from '../utils/common';

const log = defaultLogger({ serviceName: 'indeed-allocate-budget' });
log.setLogLevel('DEBUG');

const CountryBudget: Record<string, number> = {
  Canada: 60,
  'United States': 60,
  India: 15,
};
const DefaultCountryBudget = 25;
const IndeedMinJobAdBudget = 25;

/**
 * This is not a lambda yet, but it will be
 */
export async function handler(): Promise<void> {
  log.info(`Starting Indeed Budget Allocation`);

  const currentDate = DateTime.utc();
  const lastWeeksCampaignsDate = DateTime.utc()
    .minus({ weeks: 1 })
    .set({ weekday: 3, hour: 0, minute: 0, second: 0, millisecond: 0 });
  const campaignEndDateTime = DateTime.utc()
    .plus({ weeks: 1 })
    .set({ weekday: 2, hour: 23, minute: 59, second: 0, millisecond: 0 });
  log.info(`Updating Indeed Sponsoring Campaigns for the next week`);
  log.info(`Today: ${currentDate.toISODate()}, Campaigns end date time: ${campaignEndDateTime.toISO()}`);

  log.info(`Fetching Salesforce campaigns`);
  Salesforce.silent();
  const sf = await Salesforce.getAdminClient();
  const campaigns: IndeedCampaignEx[] = await IndeedDataService.fetchCampaigns(sf);
  log.info(`Fetched ${campaigns.length} campaigns`);

  // Parse the placement and group by category
  const taggedCampaigns = campaigns.filter((it) => {
    if (it.Placement__c == null) {
      return false;
    }
    it.Placement = JSON.parse(it.Placement__c);
    return it.Placement?.tag != null;
  });
  log.info(`Tagged campaigns: ${taggedCampaigns.length}`);

  const lastRun = await sf.querySOQL<{ LastRunId: number }>(`
    SELECT MAX(Run_ID__c) LastRunId
    FROM LinkedIn_Publish_Log__c
    WHERE Sourcing_Platform__c = 'Indeed'
  `);
  const pubLogs = await sf.querySOQL<PublishLog>(`
    SELECT
        Pipeline__r.ProductCode,
        Pipeline__r.Name,
        Budget__c,
        Slots_Assigned__c
    FROM LinkedIn_Publish_Log__c
    WHERE Run_ID__c = ${lastRun[0].LastRunId}
    AND Sourcing_Platform__c = 'Indeed'
    AND Budget__c > 0
  `);
  log.info(`Fetched ${pubLogs.length} publishing logs`);

  // Now start setting up sponsoring campaigns for this sourcing week
  log.info(`Calculating budget allocation`);

  // Map to store the final adjusted budget allocation and job ad count by tag
  const finalBudgetAllocation = new Map<string, TagAllocation>();
  const groupedByPipeline = groupBy(taggedCampaigns, (it) => it.Pipeline__r.ProductCode);
  for (const productCode in groupedByPipeline) {
    const pipelineCampaigns = groupedByPipeline[productCode];
    const publishLog = pubLogs.find((it) => it.Pipeline__r.ProductCode === productCode);

    if (!publishLog || publishLog.Budget__c == null) {
      log.warn(`Pipeline ${productCode} has no budget allocated`);
      continue;
    }

    const pipelineMaxBudget = Math.round(publishLog.Budget__c * 100) / 100;
    log.info(`Pipeline ${productCode} has budget $${pipelineMaxBudget} allocated`);

    // Group campaigns by tag and calculate initial budget for each tag
    const groupedByTag = groupBy(pipelineCampaigns, (it) => it.Placement?.tag ?? 'ShouldNotHappen');
    const tagBudgets = new Map<string, number>();
    let totalTagBudget = 0;

    // Calculate initial tag budgets based on country budgets
    for (const tagName in groupedByTag) {
      const jobAds = groupedByTag[tagName];
      const tagBudget = jobAds
        .map((it) => CountryBudget[it.Ad_Posted_Country_Name__c] || DefaultCountryBudget)
        .reduce((acc, cur) => acc + cur, 0);

      tagBudgets.set(tagName, tagBudget);
      totalTagBudget += tagBudget;
      log.debug(`Tag: ${tagName}, Job Ads: ${jobAds.length}, Initial Budget: $${tagBudget}`);
    }

    // Adjust tag budgets proportionally to match the pipeline budget
    if (totalTagBudget > 0) {
      const adjustmentRatio = pipelineMaxBudget / totalTagBudget;
      log.info(
        `Adjusting tag budgets with ratio ${adjustmentRatio.toFixed(
          2,
        )} to match existing pipeline budget of $${totalTagBudget} to $${pipelineMaxBudget}`,
      );

      for (const [tagName, initialBudget] of tagBudgets.entries()) {
        const adjustedBudget = Math.round(initialBudget * adjustmentRatio * 100) / 100; // Round to 2 decimal places
        finalBudgetAllocation.set(tagName, {
          budget: adjustedBudget,
          jobAdCount: groupedByTag[tagName].length,
        });
        log.info(
          `Tag: ${tagName}, Initial Budget: $${initialBudget}, Adjusted Budget: $${adjustedBudget}, Job Ads: ${groupedByTag[tagName].length}`,
        );
      }
    }
  }

  log.info(`Updating Indeed Sponsoring Campaigns`);
  const indeedApi = await IndeedApiClient.default();
  try {
    const campaignsData = await indeedApi.getCampaignsPerformance(
      lastWeeksCampaignsDate.toISODate(),
      currentDate.toISODate(),
      'ACTIVE,PAUSED',
    );
    log.info(`Active/Paused campaigns: ${campaignsData.length}`);

    // Pause all active campaigns first
    const activeCampaigns = campaignsData.filter((c) => c.adMetadata.status === 'ACTIVE');
    log.info(`Pausing ${activeCampaigns.length} active campaigns`);

    // Function to pause a single campaign
    const pauseCampaign = async (campaign: ConvertedPerformance) => {
      const status = await indeedApi.updateCampaignStatus(campaign.adKey, 'PAUSED');
      log.debug(`Campaign ${campaign.adMetadata.name} new status: ${status}`);
    };

    const batchSize = 5;
    for (let i = 0; i < activeCampaigns.length; i += batchSize) {
      const batch = activeCampaigns.slice(i, i + batchSize);
      await Promise.all(batch.map(pauseCampaign));
    }

    let totalAssignedBudget = 0;
    let totalRealBudget = 0;

    for (const [tagName, tagData] of finalBudgetAllocation) {
      // Indeed requires a minimum budget of $25 per job ad
      const indeedMinRequiredBudget = tagData.jobAdCount * IndeedMinJobAdBudget;

      // Determine the budget and adjust end date if necessary
      let budgetToUse = tagData.budget;
      let campaignEndDateTimeAdjusted = campaignEndDateTime;
      let campaignDurationDays = 7; // Default duration

      // If tagData budget is below minimum required, use minimum budget but adjust end date
      if (tagData.budget < indeedMinRequiredBudget) {
        budgetToUse = indeedMinRequiredBudget;

        // Calculate the ratio for end date adjustment (how much shorter the campaign should be)
        const budgetRatio = indeedMinRequiredBudget / tagData.budget;

        // Adjust campaign duration to scale with the budget ratio
        campaignDurationDays = Math.round(campaignDurationDays * budgetRatio);
        campaignEndDateTimeAdjusted = DateTime.utc().plus({ days: campaignDurationDays });

        log.info(
          `Tag ${tagName}: Budget adjusted from $${tagData.budget} to minimum $${indeedMinRequiredBudget}, campaign duration increased to ${campaignDurationDays} days`,
        );
      }

      // Store the adjusted values in tagData for later reporting
      tagData.realBudget = budgetToUse;
      tagData.campaignDurationDays = campaignDurationDays;

      // Update totals for reporting
      totalAssignedBudget += tagData.budget;
      totalRealBudget += budgetToUse;

      await createOrUpdateSponsoringCampaign(indeedApi, {
        campaignsData,
        tagName,
        budget: budgetToUse,
        campaignEndDateIso: campaignEndDateTimeAdjusted.toISO(),
      });
    }

    const indeedSettings = await sf.querySOQL<{ Weekly_Budget__c: number }>(`
      SELECT Weekly_Budget__c FROM IndeedJobPublishing__c
    `);
    const weeklyBudget = indeedSettings[0].Weekly_Budget__c;
    log.info(`Indeed weekly budget: $${weeklyBudget}`);

    // Log statistics for each tag and totals
    const splitter = ['-'.repeat(20), '-'.repeat(20), '-'.repeat(20), '-'.repeat(20)];
    const data: string[][] = [['Tag Name', 'Assigned Budget', 'Real Budget', 'Campaign Duration (days)'], splitter];
    for (const [tagName, tagData] of finalBudgetAllocation) {
      data.push([
        tagName,
        `$${tagData.budget.toFixed(2)}`,
        `$${tagData.realBudget?.toFixed(2)}`,
        `${tagData.campaignDurationDays}`,
      ]);
    }
    data.push(splitter);
    data.push(['TOTALS', `$${totalAssignedBudget.toFixed(2)}`, `$${totalRealBudget.toFixed(2)}`, 'N/A']);
    data.push(splitter);

    log.info('=== Indeed Budget Allocation Statistics ===');
    log.info('\n' + table(data));

    log.info(`Expected Weekly Budget: $${weeklyBudget.toFixed(2)}`);
    log.info('=== End of Statistics ===');
  } catch (e) {
    log.error('Error while updating Sponsoring Campaigns', e as Error);
  }

  await exportPublishingDataForTheWeek(currentDate, campaigns);
}

async function createOrUpdateSponsoringCampaign(
  indeedApi: IndeedApiClient,
  data: {
    campaignsData: ConvertedPerformance[];
    tagName: string;
    budget: number;
    campaignEndDateIso: string;
  },
): Promise<void> {
  const campaign = data.campaignsData.find((c) => c.adMetadata.name === data.tagName);
  if (campaign != null) {
    log.info(`Updating budget for existing campaign ${campaign.adMetadata.name}`);
    // We increase the budget for the campaign by the allocated value
    const expendedBudget = campaign.adMetadata?.adBudget?.expendedBudget?.amountInMinor ?? 0;
    const newBudget = data.budget * 100; // Indeed API expects the budget in cents
    const finalBudget = expendedBudget + newBudget;
    const status = await indeedApi.updateCampaign({
      name: campaign.adMetadata.name,
      legacyKey: campaign.adKey,
      endDateTime: data.campaignEndDateIso,
      query: `(category:("${data.tagName}"))`,
      budget: finalBudget,
      status: 'ACTIVE',
    });
    log.debug(`Campaign ${campaign.adMetadata.name} is updated, the current status is: ${status}`);
  } else {
    log.info(`Creating a new campaign for ${data.tagName}`);
    const legacyKey = await indeedApi.createCampaign({
      name: `${data.tagName}`,
      startDateTime: new Date().toISOString(),
      endDateTime: data.campaignEndDateIso,
      status: 'ACTIVE',
      query: `(category:("${data.tagName}"))`,
      budget: data.budget * 100, // Use the final budget in cents
    });
    log.debug(`Campaign ${data.tagName} is created, id is: ${legacyKey}`);
  }
}

interface TagAllocation {
  budget: number;
  jobAdCount: number;
  realBudget?: number;
  campaignDurationDays?: number;
}

interface PublishLog {
  Pipeline__r: {
    ProductCode: string;
    Name: string;
  };
  Slots_Assigned__c: number;
  Budget__c: number;
}

/**
 * Will be called from the budget-allocator later
 */
export async function exportPublishingDataForTheWeek(
  date = DateTime.utc(),
  campaigns: IndeedCampaignEx[] = [],
): Promise<void> {
  // Calculate sourcing week
  const sourcingWeek = date.weekday >= 3 ? date.startOf('week') : date.minus({ week: 1 }).startOf('week');
  const from = sourcingWeek.plus({ days: 2 }); // Wednesday
  const to = from.plus({ days: 6 }); // Tuesday

  log.info(`Exporting Indeed Publishing Data for the week ${sourcingWeek.year}-${sourcingWeek.weekNumber}`);

  Salesforce.silent();
  const sf = await Salesforce.getAdminClient();

  if (campaigns.length == 0) {
    log.info(`Fetching Salesforce campaigns`);
    campaigns = await IndeedDataService.fetchCampaigns(sf);
    log.info(`Fetched ${campaigns.length} campaigns`);
  }
  log.info(`Fetching cell analytics data for ${campaigns.length} campaigns`);
  await IndeedDataService.addAnalyticsInformation(sf, campaigns);

  const rows: IndeedPublishingRow[] = campaigns.map((it) => {
    if (it.Placement__c != null) {
      it.Placement = JSON.parse(it.Placement__c);
    }
    return {
      weekNum: sourcingWeek.toFormat('kkkk-WW'),
      campaignId: it.Id,
      campaignInternalId: it.InternalId__c,
      campaignName: it.Name,
      publishingDate: date.toISODate(),
      countryName: it.Ad_Posted_Country_Name__c,
      locationName: it.Ad_Posted_Location_Name__c ?? '',
      jobTitle: it.Ad_Title__c,
      placementLevel: it.Placement?.level ?? '',
      placementValue: it.Placement?.value ?? '',
      placementTag: it.Placement?.tag ?? '',
      pipelineCode: it.Pipeline__r.ProductCode,
      pipelineName: it.Pipeline__r.Name,
      domain: it.Pipeline__r.Family,
      compensation: it.Pipeline__r.Hourly_Rate__c,
      sourcingFrom: from.toISODate(),
      sourcingTo: to.toISODate(),
      cellType: it.Analytics?.Publish_Selection__c ?? 'Unknown',
      miningRank: it.Analytics?.MiningRank__c ?? -1,
      explorationRank: it.Analytics?.Exploration_Rank__c ?? -1,
      conversionRank: it.Analytics?.Conversion_Rank__c ?? -1,
    } as IndeedPublishingRow;
  });

  // Convert to CSV and upload to S3
  const csvData = stringify(rows, {
    header: true,
  });

  if (csvData.length > 0) {
    const bucket = `xo-hiring-production-stats-tracker-ownbackup-bucket`;
    const key = `indeed-analytics/publishing/indeed-publishing-${from.year}-${from.month}-${from.weekNumber}.csv`;
    const s3Client = new S3Client();
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: csvData,
        ContentType: 'text/csv',
      }),
    );
    log.info(`CSV file uploaded to S3 successfully at s3://${bucket}/${key}`);
  }
}

interface IndeedPublishingRow {
  weekNum: string;

  // Campaign Data
  campaignId: string;
  campaignInternalId: string;
  campaignName: string;
  publishingDate: string;
  countryName: string;
  locationName: string;
  jobTitle: string;

  // Campaign Placement
  placementLevel: string;
  placementValue: string;
  placementTag: string;

  // Pipeline Data
  pipelineCode: string;
  pipelineName: string;
  domain: string;
  compensation: number;

  // Sourcing Period (1 sourcing week)
  sourcingFrom: string;
  sourcingTo: string;
}
