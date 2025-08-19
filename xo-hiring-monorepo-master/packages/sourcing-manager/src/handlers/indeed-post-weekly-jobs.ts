import 'dotenv/config';
import { Athena, defaultLogger, Salesforce, SalesforceClient } from '@trilogy-group/xoh-integration';

const log = defaultLogger({ serviceName: 'indeed-post-weekly-jobs' });
log.setLogLevel('DEBUG');

/**
 * Implementing the automatic execution of the Indeed weekly job posting process
 * https://ws-lambda.atlassian.net/wiki/spaces/HIRE/pages/2040496200/Job+Publishing+Weekly+Process#Indeed
 *
 * This is not a lambda yet, but it will be
 */
export async function handler(): Promise<void> {
  Salesforce.silent();
  const sf = await Salesforce.getAdminClient();

  // Step 1: Select pipelines
  const pipelinesForPosting = await getPipelinesForPosting(sf);

  // Step 2: Update target CPA
  await updateTargetCPA(pipelinesForPosting, sf);

  // Step 3: Assign budget
  await assignBudget(pipelinesForPosting, sf);

  // Step 4: Reset Job Board Cells
  await resetJobBoardCells(sf);

  // Step 5: Select job ads to post
  await selectJobAdsToPost(sf);

  // Step 6: Create campaigns
  await generateCampaigns(sf);
}

async function getPipelinesForPosting(sf: SalesforceClient): Promise<PipelineInformation[]> {
  const pipelinesForPosting = await sf.querySOQL<PipelineInformation>(`
SELECT
    ProductCode,
    Id,
    Name,
    Family,
    Hourly_Rate__c,
    Monthly_Hire_Run_Rate__c,
    Target_CPA__c,
    Brand__r.Name,
    Geographic_Restriction__c
FROM Product2
WHERE Status__c = 'Active'
  AND Job_Board_Ads__c = TRUE
  AND Monthly_Hire_Run_Rate__c > 0
  `);
  log.info(`Determined ${pipelinesForPosting.length} pipelines available for posting`);

  return pipelinesForPosting;
}

/**
 * Query is taken from the https://docs.google.com/spreadsheets/d/1ewHudB-e3-oP8JtMNKrdP8WdduhlqF1oy29lErfSs5Q/edit?pli=1&gid=874383807#gid=874383807
 * @param pipelines
 * @param sf
 */
async function updateTargetCPA(pipelines: PipelineInformation[], sf: SalesforceClient): Promise<void> {
  log.info(`Querying LI historical data to update CPA`);
  const historicalData = await Athena.query<AthenaDataRow>(
    `
WITH
    liAnalyticsRows AS (
        SELECT
            Campaign.Pipeline__c, 
            case Campaign.Type
                when 'LinkedIn Job Slots' then 'LinkedIn'
                when 'LinkedIn Free Ads' then 'LinkedIn'
                when 'Indeed Job' then 'Indeed'
                when 'Google Job' then 'GoogleJobs'
                when 'LinkedIn' then 'LinkedIn'
                when 'Facebook Campaign' then 'Facebook' 
                else 'None' end sourcing_platform__c,
            SUM(Views__c) AS Views__c,
            SUM(Total_Apply_Clicks__c) AS Total_Apply_Clicks__c,
            SUM(OneClick_Apply_Clicks__c) AS OneClick_Apply_Clicks__c,
            if(SUM(cost__c) > 0, SUM(cost__c), sum(Campaign.actualcost)) as Cost__c 
        FROM Campaign
            LEFT JOIN Campaign_Analytics__c ON Campaign__c = Campaign.Id
        WHERE from_iso8601_date(Campaign.StartDate) > CAST('2022-01-31' as DATE)
        GROUP BY Campaign.Pipeline__c, 
            case Campaign.Type
                when 'LinkedIn Job Slots' then 'LinkedIn'
                when 'LinkedIn Free Ads' then 'LinkedIn'
                when 'Indeed Job' then 'Indeed'
                when 'Google Job' then 'GoogleJobs'
                when 'LinkedIn' then 'LinkedIn'
                when 'Facebook Campaign' then 'Facebook' 
                else 'None' end
    ),
    liPublishLog AS (
        SELECT
            Pipeline__c,
            Sourcing_platform__c, 
            SUM(COALESCE(Slots_Assigned__c, 0)) AS Slots_Assigned__c
        FROM Linked_In_Publish_Log__c
        WHERE from_iso8601_timestamp(CreatedDate) > CAST('2022-01-31' as DATE)
        GROUP BY Pipeline__c, Sourcing_platform__c
    ),
    pipeline AS (
        SELECT p.Id, p.ProductCode, p.Name, p.Hourly_Rate__c AS Rate, b.Name AS Company, p.Family
        FROM Product2 p
        INNER JOIN Brand__c b ON p.Brand__c = b.Id
        WHERE 1=1
            AND NOT (CAST(p.ProductCode AS INT) = 1111)
            AND NOT (CAST(p.ProductCode AS INT) = 2222)
            AND NOT (CAST(p.ProductCode AS INT) = 3333)
            AND NOT (CAST(p.ProductCode AS INT) = 4444)
            AND NOT (CAST(p.ProductCode AS INT) BETWEEN 5550 AND 5559)
            AND NOT (CAST(p.ProductCode AS INT) BETWEEN 6660 AND 6669)
            AND NOT (CAST(p.ProductCode AS INT) BETWEEN 7770 AND 7779)
            AND NOT (CAST(p.ProductCode AS INT) BETWEEN 8880 AND 8889)
            AND NOT (CAST(p.ProductCode AS INT) BETWEEN 9990 AND 9999)
    ),
    app AS (
        SELECT *,
                case LeadSource
                    when 'Easy Apply' then 'LinkedIn'
                    when 'LinkedIn Job Post' then 'LinkedIn'
                    when 'Indeed Job Post' then 'Indeed'
                    when 'Google Jobs' then 'GoogleJobs' 
                    when 'Facebook' then 'Facebook'
                    else 'None' end as SourcingPlatform
        FROM Opportunity
        WHERE from_iso8601_timestamp(CreatedDate) > CAST('2022-01-31' as DATE)
    ),
    asr AS (
        SELECT *
        FROM Application_Step_Result__c
        WHERE from_iso8601_timestamp(CreatedDate) > CAST('2022-01-31' as DATE)
    ),
    appInterviewData AS (
      SELECT
          asr.ApplicationId__c,
          MAX(
              asr.State__c NOT IN ('Scheduled', 'Waiting for Grading', 'Result_Failed', 'Result_Passed')
          ) AS hasNotScheduled,
          SUM(
              CAST(
                  asr.State__c IN ('Result_Passed')
                  AND asr.Grader__c = asrPipeline.ManagerId__c
              AS INT)              
          ) AS pmPassed,
          SUM(
              CAST(
                  asr.State__c IN ('Result_Passed')
                  AND asr.Grader__c = asrPipeline.Primary_Hiring_Manager__c
              AS INT)
          ) AS phmPassed,
          SUM(
              CAST(
                  asr.State__c IN ('Result_Failed', 'Result_Passed')
                  AND asr.Grader__c <> asrPipeline.ManagerId__c
                  AND asr.Grader__c <> asrPipeline.Primary_Hiring_Manager__c
              AS INT)
          ) AS otherCompleted,
          SUM(
              CAST(
                  asr.State__c IN ('Result_Passed')
                  AND asr.Grader__c <> asrPipeline.ManagerId__c
                  AND asr.Grader__c <> asrPipeline.Primary_Hiring_Manager__c
              AS INT)
          ) AS otherPassed
      FROM asr
      INNER JOIN Opportunity asrApp ON asr.ApplicationId__c = asrApp.Id
      INNER JOIN Product2 asrPipeline ON asrApp.Pipeline__c = asrPipeline.Id
      INNER JOIN Application_Step_Pipeline_Mapping__c stepMapping
          ON asr.Application_Step_Id__c = stepMapping.ApplicationStepId__c
          AND asrPipeline.Id = stepMapping.PipelineId__c
      INNER JOIN Application_Step__c step ON stepMapping.ApplicationStepId__c = step.Id
      WHERE step.Application_Stage__c = 'Interview'
      GROUP BY asr.ApplicationId__c
    ),
    summary AS (
        SELECT            
            pipeline.Id AS pipelineId,
            app.SourcingPlatform,
            -- application
            SUM(
                CAST(
                    app.Loss_Reason__c NOT LIKE '%Canceled EasyApply%'
                    OR app.Loss_Reason__c IS NULL
                AS INT)
            ) AS "Applications",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('CCAT', 'English', 'SMQ', 'FRQ', 'Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired')
                    OR(app.Last_Active_Stage__c = 'BFQ' AND app.StageName IN ('Rejected'))
                AS INT)
            ) AS "Completed Basic Fit",
            SUM(CAST(app.Last_Active_Stage__c IN ('CCAT', 'English', 'SMQ', 'FRQ', 'Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired') AS INT)) AS "Passed Basic Fit",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('English', 'SMQ', 'FRQ', 'Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired')
                    OR(app.Last_Active_Stage__c = 'CCAT' AND app.StageName IN ('Rejected'))
                AS INT)
            ) AS "Completed Psychocognitive",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('English', 'SMQ', 'FRQ', 'Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired')
                AS INT)
            ) AS "Passed Psychocognitive",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('SMQ', 'FRQ', 'Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired')
                    OR(app.Last_Active_Stage__c = 'English' AND app.StageName IN ('Rejected'))
                AS INT)
            ) AS "Completed Language",
            SUM(CAST(app.Last_Active_Stage__c IN ('SMQ', 'FRQ', 'Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired') AS INT)) AS "Passed Language",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('FRQ', 'Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired')
                    OR(app.Last_Active_Stage__c = 'SMQ' AND app.StageName IN ('Rejected'))
                AS INT)
            ) AS "Completed Skills",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('FRQ', 'Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired')
                AS INT)
            ) AS "Passed Skills",
            SUM(
                CAST(
                    (app.Last_Active_Stage__c IN ('Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired')
                    OR(app.Last_Active_Stage__c = 'FRQ' AND app.StageName IN ('Rejected')))
                    AND NOT (app.Last_Active_Stage__c = 'Review' AND app.Steps_Need_Grading__c > 0)
                AS INT)
            ) AS "Completed RealWork",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('Review', 'Interview', 'Offer', 'Onboarding', 'Fraud-check', 'Hired')
                    AND NOT (
                        app.Last_Active_Stage__c = 'Review'
                        AND app.StageName IN ('Rejected')
                        AND COALESCE(app.Loss_Reason__c, '') = 'Rejected Score Below Reject Threshold'
                    )
                    AND NOT (app.Last_Active_Stage__c = 'Review' AND app.Steps_Need_Grading__c > 0)
                AS INT)
            ) AS "Passed RealWork",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('Offer', 'Onboarding', 'Fraud-check', 'Hired')
                    OR app.Last_Active_Stage__c = 'Interview'
                AS INT)
            ) AS "Applications Approved for Interview",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('Onboarding', 'Fraud-check', 'Hired')
                    OR app.StageName = 'Hired'
                    OR app.Last_Active_Stage__c = 'Offer'
                AS INT)
            ) AS "Offers",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN ('Onboarding', 'Fraud-check', 'Hired')
                    OR app.StageName = 'Hired'
                AS INT)
            ) AS "Offers Accepted",
            SUM(
                CAST(
                    app.StageName = 'Hired'
                    OR(app.Last_Active_Stage__c = 'Fraud-check' AND app.StageName IN ('Rejected'))
                AS INT)
            ) AS "Completed Fraud-check",
            SUM(CAST(app.StageName = 'Hired' AS INT)) AS "Hired",
            -- application step results
            COALESCE(SUM(CAST(appInterviewData.hasNotScheduled IS NOT NULL AND hasNotScheduled = FALSE AS INT)), 0) AS "Scheduled Interviews"
        FROM app
            INNER JOIN pipeline ON app.Pipeline__c = pipeline.Id
            LEFT JOIN appInterviewData ON app.Id = appInterviewData.ApplicationId__c
        WHERE NOT (app.StageName = 'Canceled' AND COALESCE(app.Loss_Reason__c, '') LIKE 'Canceled EasyApply%')
            and from_iso8601_timestamp(app.CreatedDate) > CAST('2022-01-31' as DATE)
        GROUP BY pipeline.Id, app.SourcingPlatform
        HAVING SUM(
          CAST(
              app.Loss_Reason__c NOT LIKE '%Canceled EasyApply%'
              OR app.Loss_Reason__c IS NULL
          AS INT)
        ) > 0
    )
    SELECT
        summary.SourcingPlatform,
        pipeline.ProductCode AS "Pipeline Code",
        pipeline.Name AS "Pipeline Name",
        pipeline.Company,
        pipeline.Family as Domain,
        pipeline.Rate,
        pipeline.Id AS "Pipeline Id",
        
        COALESCE(liPublishLog.Slots_Assigned__c, 0) AS "# of Job Ads",
        
        CASE WHEN summary.SourcingPlatform='LinkedIn' then COALESCE(liPublishLog.Slots_Assigned__c, 0) * 17
            else liAnalyticsRows.Cost__c end as "Cost",
        liAnalyticsRows.Cost__c as "CostFromAnalyticsOnly",

        COALESCE(liAnalyticsRows.Views__c, 0) AS "Job Ad Views",
        CASE WHEN COALESCE(liAnalyticsRows.Views__c, 0) = 0
          THEN 0
          ELSE round(1.0 *  COALESCE(liAnalyticsRows.Total_Apply_Clicks__c, 0) / liAnalyticsRows.Views__c, 2)
        END AS "Conversion % (Job Ad Views->Job Ad Clicks)",
        COALESCE(liAnalyticsRows.Total_Apply_Clicks__c, 0) AS "Job Ad Clicks",
        CASE WHEN COALESCE(liAnalyticsRows.Total_Apply_Clicks__c, 0) = 0
          THEN 0
          ELSE round(1.0 * summary."Applications" / liAnalyticsRows.Total_Apply_Clicks__c, 2)
        END AS "Conversion % (Job Ad Clicks->Applications)",

        summary."Applications",
        CASE WHEN summary."Applications" = 0
          THEN 0
          ELSE round(1.0 * summary."Completed Basic Fit" / summary."Applications", 2)
        END AS "Conversion % (OF Applications)",
        
        summary."Completed Basic Fit",
        CASE WHEN summary."Completed Basic Fit" = 0
          THEN 0
          ELSE round(1.0 * summary."Passed Basic Fit" / summary."Completed Basic Fit", 2)
        END AS "Conversion % (OF Basic Fit Completions)",
        
        summary."Passed Basic Fit",
        
        CASE WHEN summary."Completed Basic Fit" = 0
          THEN 0
          ELSE round(1.0 * summary."Completed Psychocognitive" / summary."Completed Basic Fit", 2)
        END AS "Conversion % (OF Basic Fit Completions)",
        summary."Completed Psychocognitive",
        CASE WHEN summary."Completed Psychocognitive" = 0
          THEN 0
          ELSE round(1.0 * summary."Passed Psychocognitive" / summary."Completed Psychocognitive", 2)
        END AS "Conversion % (OF Completed Psychocognitive)",
        summary."Passed Psychocognitive",
        CASE WHEN summary."Passed Psychocognitive" = 0
          THEN 0
          ELSE round(1.0 * summary."Completed Language" / summary."Passed Psychocognitive", 2)
        END AS "Conversion % (OF Passed Psychocognitive)",
        summary."Completed Language",
        CASE WHEN summary."Completed Language" = 0
          THEN 0
          ELSE round(1.0 * summary."Passed Language" / summary."Completed Language", 2)
        END AS "Conversion % (OF Completed Language)",
        
        summary."Passed Language",
        CASE WHEN summary."Completed Language" = 0
          THEN 0
          ELSE round(1.0 * summary."Completed Skills" / summary."Completed Language", 2)
        END AS "Conversion % (OF Completed Language)",
        
        summary."Completed Skills",
        CASE WHEN summary."Completed Skills" = 0
          THEN 0
          ELSE round(1.0 * summary."Passed Skills" / summary."Completed Skills", 2)
        END AS "Conversion % (OF Completed Skills)",
        summary."Passed Skills",
        
        CASE WHEN summary."Completed Skills" = 0
          THEN 0
          ELSE round(1.0 * summary."Completed RealWork" / summary."Completed Skills", 2)
        END AS "Conversion % (OF Completed Skills)",
        
        summary."Completed RealWork",
        CASE WHEN summary."Completed RealWork" = 0
          THEN 0
          ELSE round(1.0 * summary."Passed RealWork" / summary."Completed RealWork", 2)
        END AS "Conversion % (OF Completed RealWork)",
        
        summary."Passed RealWork",
        CASE WHEN summary."Passed RealWork" = 0
          THEN 0
          ELSE round(1.0 * summary."Applications Approved for Interview" / summary."Passed RealWork", 2)
        END AS "Conversion % (OF Passed RealWork)",
        summary."Applications Approved for Interview",
        summary."Scheduled Interviews",
        summary."Offers",
        summary."Offers Accepted",
        summary."Completed Fraud-check",
        summary."Hired"
    FROM summary
        INNER JOIN pipeline ON summary.pipelineId = pipeline.Id
        LEFT JOIN liPublishLog
            ON summary.pipelineId = liPublishLog.Pipeline__c 
                and summary.SourcingPlatform = liPublishLog.Sourcing_Platform__c
        LEFT JOIN liAnalyticsRows
            ON summary.pipelineId = liAnalyticsRows.Pipeline__c
                and summary.SourcingPlatform = liAnalyticsRows.Sourcing_Platform__c
    ORDER BY pipeline.Name, summary.SourcingPlatform;
  `,
    'xo-hiring-production-stats-tracker-backup',
  );
  log.debug(`Retrieved ${historicalData.length} rows of historical data`);

  for (const pipeline of pipelines) {
    log.info(`Calculating target CPA for pipeline [${pipeline.ProductCode}] ${pipeline.Name}`);
    let liHistoricalRows = historicalData.filter(
      (it) => it['Pipeline Id'] === pipeline.Id && it.SourcingPlatform === 'LinkedIn',
    );
    let liApps = liHistoricalRows.map((it) => parseInt(it['Applications'])).reduce((a, b) => a + b, 0) ?? 0;

    if (liHistoricalRows.length === 0 || liApps < 100) {
      log.debug(
        `  No historical data found for this specific pipeline or total applications below threshold (${liApps})`,
      );
      // Fallback to the same family&compensation data
      liHistoricalRows = historicalData.filter(
        (it) =>
          it.Domain === pipeline.Family &&
          parseInt(it.Rate) === pipeline.Hourly_Rate__c &&
          it.SourcingPlatform === 'LinkedIn',
      );
      log.debug(
        `  Calculating based on ${liHistoricalRows.length} rows of historical data for the same domain & compensation`,
      );
    }
    if (liHistoricalRows.length === 0) {
      log.warn(`  No historical data found for this pipeline's domain & compensation, ignoring pipeline`);
      continue;
    }

    const liCost = liHistoricalRows.map((it) => parseFloat(it.Cost)).reduce((a, b) => a + b, 0);
    liApps = liHistoricalRows.map((it) => parseInt(it['Applications'])).reduce((a, b) => a + b, 0);
    const liCpA = parseFloat((liCost / liApps).toFixed(2));

    log.info(
      `  Historical data: ${liApps} applications, $${liCost} cost :: Target CPA = $${liCpA} :: Current CPA = $${pipeline.Target_CPA__c}`,
    );

    try {
      await sf.updateObject('Product2', pipeline.Id, {
        Target_CPA__c: liCpA,
      });
    } catch (e) {
      log.warn(`  Failed to update target CPA for pipeline ${pipeline.ProductCode}`, e as Error);
    }
  }
}

async function assignBudget(pipelines: PipelineInformation[], sf: SalesforceClient): Promise<void> {
  log.info(`Starting Indeed_AssignBudget batchable and waiting for it to finish`);
  await sf.executeAnonymousApex(`
    Indeed_AssignBudget.run();
  `);
  await waitForTheBatchable('Indeed_AssignBudget', sf, 60 * 30);
  await sleep(1000);
  log.info(`Indeed_AssignBudget completed`);
}

async function selectJobAdsToPost(sf: SalesforceClient): Promise<void> {
  log.info(`Starting Indeed_SelectJobAdsToPost batchable and waiting for it to finish`);
  await sf.executeAnonymousApex(`
    Indeed_SelectJobAdsToPost.run();
  `);
  await waitForTheBatchable('Indeed_SelectJobAdsToPost', sf, 60 * 30);
  await sleep(1000);
  log.info(`Indeed_SelectJobAdsToPost completed`);
}

async function resetJobBoardCells(sf: SalesforceClient): Promise<void> {
  log.info(`Starting Indeed_ResetJobBoardCellSelection batchable and waiting for it to finish`);
  await sf.executeAnonymousApex(`
    Indeed_ResetJobBoardCellSelection.run();
  `);
  await waitForTheBatchable('Indeed_ResetJobBoardCellSelection', sf, 60 * 10);
  await sleep(1000);
  log.info(`Indeed_ResetJobBoardCellSelection completed`);
}

async function generateCampaigns(sf: SalesforceClient): Promise<void> {
  log.info(`Starting Indeed_CampaignsGenerator batchable and waiting for it to finish`);
  await sf.executeAnonymousApex(`
    Indeed_CampaignsGenerator.run();
  `);
  await waitForTheBatchable('Indeed_CampaignsGenerator', sf, 60 * 40);
  await sleep(1000);
  log.info(`Indeed_CampaignsGenerator completed`);
}

/**
 * Wait for the batchable to complete
 * @param name Batchable name
 * @param sf Salesforce client
 * @param timeout Timeout in seconds
 */
async function waitForTheBatchable(name: string, sf: SalesforceClient, timeout = 300): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout * 1000) {
    const batchableStatus = await sf.querySOQL<{
      Status: string;
      CompletedDate: string;
      NumberOfErrors: number;
    }>(`
      SELECT Status, CompletedDate, CreatedDate, NumberOfErrors
      FROM AsyncApexJob
      WHERE ApexClass.Name = '${name}'
      AND CreatedDate >= LAST_N_DAYS:2
      ORDER BY CreatedDate DESC
      LIMIT 1
  `);

    // Maybe not queued yet
    if (batchableStatus.length === 0) {
      // Give 10 seconds to be queued
      if (Date.now() - start > 10000) {
        log.debug('Batchable not found in the last 2 days, retrying');
        await sleep(1000);
      } else {
        throw new Error(`Batchable ${name} not found in the last 2 days (non queued?)`);
      }
    }

    if (batchableStatus[0].Status === 'Completed') {
      log.debug(`Batchable ${name} completed in ${Date.now() - start}ms`);
      return;
    } else if (batchableStatus[0].Status === 'Failed') {
      throw new Error(`Batchable ${name} failed with ${batchableStatus[0].NumberOfErrors} errors`);
    } else {
      // log.debug(`Batchable ${name} is still running :: ${batchableStatus[0].Status} :: ${batchableStatus[0].CompletedDate}`);
      await sleep(1000);
    }
  }
  throw new Error(`Batchable ${name} did not complete in ${timeout}s`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PipelineInformation {
  ProductCode: string;
  Id: string;
  Name: string;
  Family: string;
  Hourly_Rate__c: number;
  Monthly_Hire_Run_Rate__c: number;
  Target_CPA__c: number;
  Brand__r: {
    Name: string;
  };
}

interface AthenaDataRow {
  SourcingPlatform: string;
  'Pipeline Code': string;
  'Pipeline Name': string;
  Company: string;
  Domain: string;
  Rate: string;
  'Pipeline Id': string;
  '# of Job Ads': string;
  Cost: string;
  CostFromAnalyticsOnly: string;
  'Job Ad Views': string;
  'Conversion % (Job Ad Views->Job Ad Clicks)': string;
  'Job Ad Clicks': string;
  'Conversion % (Job Ad Clicks->Applications)': string;
  Applications: string;
  'Conversion % (OF Applications)': string;
  'Completed Basic Fit': string;
  'Conversion % (OF Basic Fit Completions)': string;
  'Passed Basic Fit': string;
  'Completed Psychocognitive': string;
  'Conversion % (OF Completed Psychocognitive)': string;
  'Passed Psychocognitive': string;
  'Conversion % (OF Passed Psychocognitive)': string;
  'Completed Language': string;
  'Conversion % (OF Completed Language)': string;
  'Passed Language': string;
  'Completed Skills': string;
  'Conversion % (OF Completed Skills)': string;
  'Passed Skills': string;
  'Completed RealWork': string;
  'Conversion % (OF Completed RealWork)': string;
  'Passed RealWork': string;
  'Conversion % (OF Passed RealWork)': string;
  'Applications Approved for Interview': string;
  'Scheduled Interviews': string;
  Offers: string;
  'Offers Accepted': string;
  'Completed Fraud-check': string;
  Hired: string;
}
