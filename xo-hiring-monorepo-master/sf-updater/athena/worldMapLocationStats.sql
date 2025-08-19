WITH ca_stats AS (
	SELECT p.sourcing_world_map__c AS Wm,
		jbc.location__c AS Loc,
		arbitrary(loc.country__c) AS Country,
		AVG(ca.views__c / ca.days_active__c) * 7 AS Avg_Weekly_Views__c,
		AVG(ca.total_apply_clicks__c / ca.days_active__c) * 7 AS Avg_Weekly_Clicks__c,
		COALESCE(SUM(ca.days_active__c) / 7, 0) AS AdvertisementWeeks__c
	FROM campaign_analytics__c ca
		JOIN campaign c ON ca.campaign__c = c.id
		JOIN product2 p ON c.pipeline__c = p.id
		JOIN job_board_cell__c jbc ON c.job_board_cell__c = jbc.id
		JOIN location__c loc ON jbc.location__c = loc.id
	WHERE from_iso8601_timestamp(ca.week_start__c) >= date '2020-01-01'
		AND ca.sourcing_platform__c = 'LinkedIn'
		AND ca.days_active__c IS NOT NULL
		AND ca.days_active__c > 0
	GROUP BY p.sourcing_world_map__c,
		jbc.location__c
),
ca_stats_by_country AS (
	SELECT Wm,
		Country,
		AVG(Avg_Weekly_Views__c) AS Avg_Weekly_Views__c,
		AVG(Avg_Weekly_Clicks__c) AS Avg_Weekly_Clicks__c,
		SUM(AdvertisementWeeks__c) AS AdvertisementWeeks__c
	FROM ca_stats
	GROUP BY Wm,
		Country
),
indeed_spent AS (
    select
        jbc.location__c AS Loc,
        p.sourcing_world_map__c AS Wm,
        coalesce(SUM(cost__c), 0) as cost
    from job_board_cell_analytics__c jbca
             left join job_board_cell__c jbc on jbc.id = jbca.job_board_cell__c
             left join pipeline_job_title__c pjt on pjt.id = jbc.pipeline_job_title__c
             left join product2 p on p.id = pjt.pipeline__c
    where jbca.sourcing_platform__c = 'Indeed'
      and from_iso8601_timestamp(jbca.createddate) >= date '2024-05-01'
    group by jbc.location__c, p.sourcing_world_map__c
),
asr_stats AS (
    SELECT
        p.sourcing_world_map__c AS Wm,
        acc.location__c AS Loc,
        COUNT(distinct asr.id) AS CCAT_Passers__c
    FROM application_step_result__c asr
             JOIN opportunity app on asr.applicationid__c = app.id
             JOIN product2 p on app.pipeline__c = p.id
             JOIN account acc on app.accountid = acc.id
             JOIN application_step__c aps on asr.application_step_id__c = aps.id
             JOIN location__c loc ON acc.location__c = loc.id
    WHERE from_iso8601_timestamp(app.apply_date__c) >= date '2020-01-01'
      AND p.sourcing_world_map__c IS NOT NULL
      AND asr.state__c = 'Result_Passed'
      AND aps.application_stage__c = 'CCAT'
    GROUP BY p.sourcing_world_map__c,
             acc.location__c
),
app_stats AS (
	SELECT p.sourcing_world_map__c AS Wm,
		acc.location__c AS Loc,
		arbitrary(loc.country__c) AS Country,
		COUNT(app.ismql__c) AS MQLTestTakers__c,
		COALESCE(SUM(app.ismql__c), 0) AS MQLs__c,
		COUNT(app.issql__c) AS SQLTestTakers__c,
		COALESCE(SUM(app.issql__c), 0) AS SQLs__c,
		COUNT(app.passedinterview__c) AS InterviewTestTakers__c,
		COALESCE(SUM(app.passedinterview__c), 0) AS InterviewPassers__c,
		COALESCE(SUM(IF(app.StageName = 'Hired', 1, 0)), 0) AS Hires__c,
        COUNT(app.id) AS Applications_From_All_Channels__c,
        SUM(if (app.leadsource = 'Indeed Job Post' AND from_iso8601_timestamp(app.apply_date__c) >= date '2024-05-01', 1, 0)) AS Applications_From_Indeed__c
	FROM opportunity app
		JOIN product2 p on app.pipeline__c = p.id
		JOIN account acc on app.accountid = acc.id
		JOIN location__c loc ON acc.location__c = loc.id
	WHERE from_iso8601_timestamp(app.apply_date__c) >= date '2020-01-01'
		AND p.sourcing_world_map__c IS NOT NULL
	GROUP BY p.sourcing_world_map__c,
		acc.location__c
),
app_stats_with_indeed_data AS (
    SELECT
        aps.*,
        COALESCE(asrs.CCAT_Passers__c, 0) AS CCAT_Passers__c,
        IF(COALESCE(aps.Applications_From_Indeed__c, 0) > 0, COALESCE(insp.cost, 0) / COALESCE(aps.Applications_From_Indeed__c, 0), 0) AS Average_CPA_for_Indeed__c
    FROM app_stats aps
        LEFT JOIN indeed_spent insp ON aps.Wm = insp.Wm AND aps.Loc = insp.Loc
        LEFT JOIN asr_stats asrs ON aps.Wm = asrs.Wm AND aps.Loc = asrs.Loc
),
app_stats_by_country AS (
	SELECT Wm,
		Country,
		SUM(MQLTestTakers__c) AS MQLTestTakers__c,
		SUM(MQLs__c) AS MQLs__c,
		SUM(SQLTestTakers__c) AS SQLTestTakers__c,
		SUM(SQLs__c) AS SQLs__c,
		SUM(InterviewTestTakers__c) AS InterviewTestTakers__c,
		SUM(InterviewPassers__c) AS InterviewPassers__c,
		SUM(Hires__c) AS Hires__c,
        SUM(Applications_From_All_Channels__c) AS Applications_From_All_Channels__c,
        SUM(Applications_From_Indeed__c) AS Applications_From_Indeed__c,
        SUM(CCAT_Passers__c) AS CCAT_Passers__c,
        AVG(Average_CPA_for_Indeed__c) AS Average_CPA_for_Indeed__c
	FROM app_stats_with_indeed_data
	GROUP BY Wm,
		Country
)
SELECT wml.id AS Id,
	casbc.Avg_Weekly_Views__c,
	casbc.Avg_Weekly_Clicks__c,
	COALESCE(casbc.AdvertisementWeeks__c, 0) AS AdvertisementWeeks__c,
	COALESCE(appsbc.MQLTestTakers__c, 0) AS MQLTestTakers__c,
	COALESCE(appsbc.MQLs__c, 0) AS MQLs__c,
	COALESCE(appsbc.SQLTestTakers__c, 0) AS SQLTestTakers__c,
	COALESCE(appsbc.SQLs__c, 0) AS SQLs__c,
	COALESCE(appsbc.InterviewTestTakers__c, 0) AS InterviewTestTakers__c,
	COALESCE(appsbc.InterviewPassers__c, 0) AS InterviewPassers__c,
	COALESCE(appsbc.Hires__c, 0) AS Hires__c,
    COALESCE(appsbc.Applications_From_All_Channels__c, 0) AS Applications_From_All_Channels__c,
    COALESCE(appsbc.Applications_From_Indeed__c, 0) AS Applications_From_Indeed__c,
    COALESCE(appsbc.CCAT_Passers__c, 0) AS CCAT_Passers__c,
    COALESCE(appsbc.Average_CPA_for_Indeed__c, 0) AS Average_CPA_for_Indeed__c
FROM world_map_location__c wml
	JOIN world_map__c wm ON wml.world_map__c = wm.id
	JOIN location__c loc on wml.location__c = loc.id
	LEFT JOIN ca_stats_by_country casbc ON (
		casbc.Wm = wm.id
		AND casbc.Country = loc.country__c
	)
	LEFT JOIN app_stats_by_country appsbc ON (
		appsbc.Wm = wm.id
		AND appsbc.Country = loc.country__c
	)
WHERE loc.Name_in_Recruiter__c IS NULL
UNION
SELECT wml.id AS Id,
	cas.Avg_Weekly_Views__c,
	cas.Avg_Weekly_Clicks__c,
	COALESCE(cas.AdvertisementWeeks__c, 0) AS AdvertisementWeeks__c,
	COALESCE(apps.MQLTestTakers__c, 0) AS MQLTestTakers__c,
	COALESCE(apps.MQLs__c, 0) AS MQLs__c,
	COALESCE(apps.SQLTestTakers__c, 0) AS SQLTestTakers__c,
	COALESCE(apps.SQLs__c, 0) AS SQLs__c,
	COALESCE(apps.InterviewTestTakers__c, 0) AS InterviewTestTakers__c,
	COALESCE(apps.InterviewPassers__c, 0) AS InterviewPassers__c,
	COALESCE(apps.Hires__c, 0) AS Hires__c,
    COALESCE(apps.Applications_From_All_Channels__c, 0) AS Applications_From_All_Channels__c,
    COALESCE(apps.Applications_From_Indeed__c, 0) AS Applications_From_Indeed__c,
    COALESCE(apps.CCAT_Passers__c, 0) AS CCAT_Passers__c,
    COALESCE(apps.Average_CPA_for_Indeed__c, 0) AS Average_CPA_for_Indeed__c
FROM world_map_location__c wml
	JOIN world_map__c wm ON wml.world_map__c = wm.id
	JOIN location__c loc on wml.location__c = loc.id
	LEFT JOIN ca_stats cas ON (
		cas.Wm = wm.id
		AND cas.Loc = loc.id
	)
	LEFT JOIN app_stats_with_indeed_data apps ON (
		apps.Wm = wm.id
		AND apps.Loc = loc.id
	)
WHERE loc.Name_in_Recruiter__c IS NOT NULL
