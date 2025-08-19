function getStagesAfter(stage: string) {
  // all stages after 'stage' indicate that the 'stage' has passed successfully for candidate (towards to Hired)
  const orderedStages = [
    'BFQ',
    'Commitment',
    'CCAT',
    // <-- MQL here, but there's no stage for it
    'English',
    'SMQ',
    'FRQ',
    'Review',
    // <-- SQL here, but there's no stage for it
    'Interview',
    'Marketplace',
    'Offer',
    'Onboarding',
    'Fraud-check',
    'Hired',
  ];
  const index = orderedStages.indexOf(stage);
  if (index < 0 || stage === 'Hired') {
    throw new Error('Error during query generation: invalid stage.');
  }

  return orderedStages
    .slice(orderedStages.indexOf(stage) + 1)
    .map((s) => `'${s}'`)
    .join(',');
}

export function getOpportunitiesQuery() {
  const leadSourceExpr = "'Easy Apply'";
  const rejectionStages = "'Rejected'";

  return `\
WITH
    liAnalyticsRows AS (
        SELECT Week_Start__c, LI_Ad_Pipeline_Code__c,
            SUM(Views__c) AS Views__c,
            SUM(Total_Apply_Clicks__c) AS Total_Apply_Clicks__c,
            SUM(OneClick_Apply_Clicks__c) AS OneClick_Apply_Clicks__c
        FROM Campaign_Analytics__c
        INNER JOIN Campaign ON Campaign__c = Campaign.Id
        GROUP BY Week_Start__c, LI_Ad_Pipeline_Code__c
    ),
    liPublishLog AS (
        SELECT
            Run_ID__c,
            Pipeline__c,
            date(date_add('day', 1 - day_of_week(from_iso8601_timestamp(MIN(CreatedDate))), from_iso8601_timestamp(MIN(CreatedDate)))) AS WeekStart,
            SUM(COALESCE(Slots_Assigned__c, 0)) AS Slots_Assigned__c
        FROM Linked_In_Publish_Log__c
        GROUP BY Run_ID__c, Pipeline__c
        ORDER BY WeekStart DESC
    ),
    pipeline AS (
        SELECT p.Id, p.ProductCode, p.Name, p.Hourly_Rate__c AS Rate, b.Name AS Company
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
            AND ((p.type__c IS NULL) OR (p.type__c != 'Category job'))
    ),
    app AS (
        SELECT *
        FROM Opportunity
    ),
    asr AS (
        SELECT *
        FROM Application_Step_Result__c
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

            -- application
            date(date_add('day', 1 - day_of_week(from_iso8601_timestamp(app.CreatedDate)), from_iso8601_timestamp(app.CreatedDate))) AS "Week Start",
            SUM(
                CAST (
                    app.LeadSource IN (${leadSourceExpr})
                    AND(
                        app.Loss_Reason__c NOT LIKE '%Canceled EasyApply%'
                        OR app.Loss_Reason__c IS NULL
                    )
                AS INT)
            ) AS "applications_unique_job_ad",
            SUM(
                CAST(
                    app.Loss_Reason__c NOT LIKE '%Canceled EasyApply%'
                    OR app.Loss_Reason__c IS NULL
                AS INT)
            ) AS "applications",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('BFQ')})
                    OR(app.Last_Active_Stage__c = 'BFQ' AND app.StageName IN (${rejectionStages}))
                AS INT)
            ) AS "bfq_completed",
            SUM(CAST(app.Last_Active_Stage__c IN (${getStagesAfter('BFQ')}) AS INT)) AS "bfq_passed",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('CCAT')})
                    OR(app.Last_Active_Stage__c = 'CCAT' AND app.StageName IN (${rejectionStages}))
                AS INT)
            ) AS "ccat_completed",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('CCAT')})
                AS INT)
            ) AS "ccat_passed",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('English')})
                    OR(app.Last_Active_Stage__c = 'English' AND app.StageName IN (${rejectionStages}))
                AS INT)
            ) AS "Completed Language",
            SUM(CAST(app.Last_Active_Stage__c IN (${getStagesAfter('English')}) AS INT)) AS "language_passed",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('SMQ')})
                    OR(app.Last_Active_Stage__c = 'SMQ' AND app.StageName IN (${rejectionStages}))
                AS INT)
            ) AS "skills_completed",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('SMQ')})
                AS INT)
            ) AS "skills_passed",
            SUM(
                CAST(
                    (app.Last_Active_Stage__c IN (${getStagesAfter('FRQ')})
                    OR(app.Last_Active_Stage__c = 'FRQ' AND app.StageName IN (${rejectionStages})))
                    AND NOT (app.Last_Active_Stage__c = 'Review' AND app.Steps_Need_Grading__c > 0)
                AS INT)
            ) AS "realwork_completed",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('FRQ')})
                    AND NOT (
                        app.Last_Active_Stage__c = 'Review'
                        AND app.StageName IN (${rejectionStages})
                        AND COALESCE(app.Loss_Reason__c, '') = 'Rejected Score Below Reject Threshold'
                    )
                    AND NOT (app.Last_Active_Stage__c = 'Review' AND app.Steps_Need_Grading__c > 0)
                AS INT)
            ) AS "realwork_passed",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('Interview')})
                    OR app.Last_Active_Stage__c = 'Interview'
                AS INT)
            ) AS "interview_invited",

            SUM(CAST(app.PM_Interviewed__c AS INT)) AS "interview_completed_pm",
            SUM(CAST(app.PHM_Interviewed__c AS INT)) AS "interview_completed_phm",

            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('Offer')})
                    OR app.StageName = 'Hired'
                    OR app.Last_Active_Stage__c = 'Offer'
                AS INT)
            ) AS "offers_extended",
            SUM(
                CAST(
                    app.Last_Active_Stage__c IN (${getStagesAfter('Offer')})
                    OR app.StageName = 'Hired'
                AS INT)
            ) AS "offers_accepted",

            SUM(
                CAST(
                    app.StageName = 'Hired'
                    OR(app.Last_Active_Stage__c = 'Fraud-check' AND app.StageName IN (${rejectionStages}))
                AS INT)
            ) AS "fraudcheck_completed",
            SUM(CAST(app.StageName = 'Hired' AS INT)) AS "hired",

            -- application step results
            COALESCE(SUM(CAST(appInterviewData.hasNotScheduled IS NOT NULL AND hasNotScheduled = FALSE AS INT)), 0) AS "interview_scheduled",
            COALESCE(SUM(CAST(appInterviewData.pmPassed AS INT)), 0) AS "interview_passed_pm",
            COALESCE(SUM(CAST(appInterviewData.phmPassed AS INT)), 0) AS "interview_passed_phm",
            COALESCE(SUM(CAST(appInterviewData.otherCompleted AS INT)), 0) AS "interview_completed_other",
            COALESCE(SUM(CAST(appInterviewData.otherPassed AS INT)), 0) AS "interview_passed_other"
        FROM app
            INNER JOIN pipeline ON app.Pipeline__c = pipeline.Id
            LEFT JOIN appInterviewData ON app.Id = appInterviewData.ApplicationId__c
        WHERE NOT (app.StageName = 'Canceled' AND COALESCE(app.Loss_Reason__c, '') LIKE 'Canceled EasyApply%')
        GROUP BY pipeline.Id, date(date_add('day', 1 - day_of_week(from_iso8601_timestamp(app.CreatedDate)), from_iso8601_timestamp(app.CreatedDate)))
        HAVING SUM(
          CAST(
              app.Loss_Reason__c NOT LIKE '%Canceled EasyApply%'
              OR app.Loss_Reason__c IS NULL
          AS INT)
        ) > 0
    )
    SELECT
        pipeline.Id AS "pipeline_id",
        pipeline.ProductCode AS "pipeline_code",
        pipeline.Name AS "pipeline_name",
        pipeline.Company as "company",
        pipeline.Rate as "rate",

        summary."Week Start" as "week_start",
        date_add('day', 6, summary."Week Start") AS "week_end",

        COALESCE(liPublishLog.Slots_Assigned__c, 0) AS "job_ads",

        CASE WHEN COALESCE(liPublishLog.Slots_Assigned__c, 0) = 0
            THEN 0
            ELSE 1.0 * COALESCE(liAnalyticsRows.Views__c, 0) / liPublishLog.Slots_Assigned__c
        END AS "job_ads_views_average_per_ad",

        CASE WHEN COALESCE(liPublishLog.Slots_Assigned__c, 0) = 0
            THEN 0
            ELSE 1.0 * COALESCE(liAnalyticsRows.Views__c, 0) / (7 * liPublishLog.Slots_Assigned__c)
        END AS "job_ads_views_average_per_ad_per_day",        

        COALESCE(liAnalyticsRows.Views__c, 0) AS "job_ads_views",

        CASE WHEN COALESCE(liAnalyticsRows.Views__c, 0) = 0
          THEN 0
          ELSE 1.0 *  COALESCE(liAnalyticsRows.Total_Apply_Clicks__c, 0) / liAnalyticsRows.Views__c
        END AS "job_ads_clicks_conversion_of_views",

        COALESCE(liAnalyticsRows.Total_Apply_Clicks__c, 0) AS "job_ads_clicks",

        CASE WHEN COALESCE(liAnalyticsRows.Total_Apply_Clicks__c, 0) = 0
          THEN 0
          ELSE 1.0 * summary."applications_unique_job_ad" / liAnalyticsRows.Total_Apply_Clicks__c
        END AS "applications_unique_job_ad_conversion_of_job_ads_clicks",

        summary."applications_unique_job_ad",
        summary."applications",

        CASE WHEN summary."applications" = 0
          THEN 0
          ELSE 1.0 * summary."bfq_completed" / summary."applications"
        END AS "bfq_completed_conversion_of_applications",
        
        summary."bfq_completed",

        CASE WHEN summary."bfq_completed" = 0
          THEN 0
          ELSE 1.0 * summary."bfq_passed" / summary."bfq_completed"
        END AS "bfq_passed_conversion_of_applications",
        
        summary."bfq_passed",
        
        CASE WHEN summary."bfq_completed" = 0
          THEN 0
          ELSE 1.0 * summary."ccat_completed" / summary."bfq_completed"
        END AS "ccat_completed_conversion_of_applications",

        summary."ccat_completed",

        CASE WHEN summary."ccat_completed" = 0
          THEN 0
          ELSE 1.0 * summary."ccat_passed" / summary."ccat_completed"
        END AS "ccat_passed_conversion_of_ccat_completed",

        summary."ccat_passed",

        CASE WHEN summary."ccat_passed" = 0
          THEN 0
          ELSE 1.0 * summary."Completed Language" / summary."ccat_passed"
        END AS "language_completed_conversion_of_ccat_passed",

        summary."Completed Language" as "language_completed",

        CASE WHEN summary."Completed Language" = 0
          THEN 0
          ELSE 1.0 * summary."language_passed" / summary."Completed Language"
        END AS "language_passed_conversion_of_language_completed",
        
        summary."language_passed",

        CASE WHEN summary."Completed Language" = 0
          THEN 0
          ELSE 1.0 * summary."skills_completed" / summary."Completed Language"
        END AS "skills_completed_conversion_of_language_completed",
        
        summary."skills_completed",

        CASE WHEN summary."skills_completed" = 0
          THEN 0
          ELSE 1.0 * summary."skills_passed" / summary."skills_completed"
        END AS "skills_passed_conversion_of_skills_completed",

        summary."skills_passed",
        
        CASE WHEN summary."skills_completed" = 0
          THEN 0
          ELSE 1.0 * summary."realwork_completed" / summary."skills_completed"
        END AS "realwork_completed_conversion_of_skills_completed",
        
        summary."realwork_completed",

        CASE WHEN summary."realwork_completed" = 0
          THEN 0
          ELSE 1.0 * summary."realwork_passed" / summary."realwork_completed"
        END AS "realwork_passed_conversion_of_realwork_completed",
        
        summary."realwork_passed",

        CASE WHEN summary."realwork_passed" = 0
          THEN 0
          ELSE 1.0 * summary."interview_invited" / summary."realwork_passed"
        END AS "interview_invited_conversion_of_realwork_passed",

        summary."interview_invited",
        summary."interview_scheduled",
        summary."interview_completed_pm",
        summary."interview_passed_pm",
        summary."interview_completed_phm",
        summary."interview_passed_phm",
        summary."interview_completed_other",
        summary."interview_passed_other",
        summary."offers_extended",
        summary."offers_accepted",
        summary."fraudcheck_completed",
        summary."hired"
    FROM summary
    INNER JOIN pipeline ON summary.pipelineId = pipeline.Id
    LEFT JOIN liPublishLog
        ON summary.pipelineId = liPublishLog.Pipeline__c
        AND summary."Week Start" = liPublishLog.WeekStart
    LEFT JOIN liAnalyticsRows
        ON pipeline.ProductCode = liAnalyticsRows.LI_Ad_Pipeline_Code__c
        AND summary."Week Start" = from_iso8601_date(liAnalyticsRows.Week_Start__c)
    ORDER BY summary."Week Start" DESC, pipeline.Name;
`;
}
