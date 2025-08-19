import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';
import { AxiosError } from 'axios';
import { DateTime } from 'luxon';
import { IndeedApiClient, JobAnalytics } from '../integrations/indeed';
import { stringify } from 'csv-stringify/sync';

const log = defaultLogger({ serviceName: 'indeed-fetch-analytics' });
log.setLogLevel('DEBUG');

const WeeksToFetch = 2; // Including the current week, even if it just started
const BatchSize = 8000;

/**
 * Lambda handler
 */
export async function handler(): Promise<void> {
  const indeedApi = await IndeedApiClient.default();
  const currentDate = DateTime.utc();

  await exportSourcingWeeklyDataToAthena(currentDate, indeedApi);

  // Also fetch natural weekly data into salesforce
  await exportNaturalWeeklyDataToSalesforce(currentDate, indeedApi);
}

/**
 * Export weekly data to Salesforce. Export is done based on natural weeks (Monday to Sunday)
 * Previously has been done via esw-job-slot-publishing tool
 * @param currentDate
 * @param indeedApi
 */
export async function exportNaturalWeeklyDataToSalesforce(
  currentDate: DateTime,
  indeedApi: IndeedApiClient,
): Promise<void> {
  Salesforce.silent();
  const sf = await Salesforce.getAdminClient();

  for (let i = 0; i < WeeksToFetch; i++) {
    const weekStart = currentDate.minus({ weeks: i }).startOf('week');
    let weekEnd = weekStart.plus({ days: 6 });
    if (weekEnd > currentDate) {
      // Do not query future data, we are not time travelers
      weekEnd = currentDate;
    }

    log.info(`Fetching Indeed Analytics from ${weekStart.toISODate()} to ${weekEnd.toISODate()}`);
    const analytics: JobAnalyticsEx[] = await indeedApi.exportAnalytics(
      weekStart.toISODate() as string,
      weekEnd.toISODate() as string,
    );
    log.info(`Fetched ${analytics.length} ad records`);

    const transformedData = analytics.map((row) => ({
      internalId: row.jobReferenceNumber,
      views: row.sumClicks, // Clicks are views in Indeed
      impressions: row.sumImpressions,
      easyApplies: row.sumApplies,
      normalApplies: row.sumApplies, // Indeed only has one-click applies (Indeed Apply)
      JobPoster: row.jobCompanyName,
      cost: row.sumCostLocal,
    }));

    const week = parseInt(weekStart.toFormat('W'));
    const year = parseInt(weekStart.toFormat('kkkk'));

    for (let j = 0; j < transformedData.length; j += BatchSize) {
      const batch = transformedData.slice(j, j + BatchSize);
      try {
        log.info(`Calling the import REST API for week ${year}.${week}, batch ${j / BatchSize + 1}...`);
        const result = await sf.invokeInvokableClass('ImportIndeedAnalyticsForWeekAction', {
          inputs: [
            {
              analyticsRows: batch,
              week,
              year,
            },
          ],
        });

        log.info(`Import result: ${JSON.stringify(result.data)}`, result.data);
      } catch (e) {
        if (e instanceof AxiosError) {
          const responseBody = e.response?.data ? JSON.stringify(e.response.data) : 'No response body';
          throw new Error(`Salesforce API (Code ${e.response?.status}): ${e.message}. Body: ${responseBody}`);
        } else {
          throw e;
        }
      }
    }
  }
}

/**
 * Export weekly data to Athena. Export is done based on sourcing weeks (Wednesday to Tuesday)
 * This data is used by the Indeed sourcing views and QuickSight Dashboards
 */
export async function exportSourcingWeeklyDataToAthena(
  currentDate: DateTime,
  indeedApi: IndeedApiClient,
): Promise<void> {
  log.info(`Starting Indeed Sourcing Weekly Analytics Export for ${WeeksToFetch} weeks`);
  // Calculate the from-to pairs for the weeks to fetch
  // Include the new week if it is Wednesday or later
  const fromToPairs: { from: DateTime; to: DateTime }[] = [];
  const currentSourcingWeek =
    currentDate.weekday >= 3 ? currentDate.startOf('week') : currentDate.minus({ week: 1 }).startOf('week');
  for (let i = 0; i < WeeksToFetch; i++) {
    const sourcingWeek = currentSourcingWeek.minus({ weeks: i });
    const from = sourcingWeek.plus({ days: 2 }); // Wednesday
    let to = from.plus({ days: 6 }); // Tuesday
    if (to > currentDate) {
      // Do not query future data, we are not time travelers
      to = currentDate;
    }
    fromToPairs.push({ from, to });
  }

  for (const { from, to } of fromToPairs) {
    await exportWeeklyAnalyticsForWeek(from, to, indeedApi);
  }
}

export function processWeeklyAnalytics(analytics: JobAnalytics[], weekStart: DateTime): JobAnalyticsEx[] {
  const processedAnalytics: JobAnalyticsEx[] = analytics.map((record) => ({
    ...record,
    weekNum: weekStart.toFormat('kkkk-WW'),
    weekDate: weekStart.startOf('week').toFormat('yyyy-MM-dd'),
    sourcingWeekDate: weekStart.toFormat('yyyy-MM-dd'),
  }));

  const totalSum = processedAnalytics.reduce((sum, record) => sum + record.sumCostLocal, 0);
  log.info(`Total cost for week: $${Math.round(totalSum)}`);

  return processedAnalytics;
}

export async function exportWeeklyAnalyticsForWeek(from: DateTime, to: DateTime, api: IndeedApiClient): Promise<void> {
  const fromIso = from.toISODate() as string;
  const toIso = to.toISODate() as string;

  log.info(`Fetching Indeed Analytics from ${fromIso} to ${toIso}`);
  const rawAnalytics = await api.exportAnalytics(fromIso, toIso);
  log.info(`Fetched ${rawAnalytics.length} ad records`);

  const processedAnalytics = processWeeklyAnalytics(rawAnalytics, from);

  // Convert to CSV and upload to S3
  const csvData = stringify(processedAnalytics, {
    header: true,
  });

  if (csvData.length > 0) {
    const bucket = process.env.ATHENA_ANALYTICS_BUCKET;
    if (bucket == null) {
      throw new Error('ATHENA_ANALYTICS_BUCKET environment variable is not set');
    }

    const key = `indeed-analytics/analytics-v2/indeed-analytics-${from.toFormat('yyyy-MM-dd')}.csv`;
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

interface JobAnalyticsEx extends JobAnalytics {
  weekNum?: string;
  weekDate?: string;
  sourcingWeekDate?: string;
}
