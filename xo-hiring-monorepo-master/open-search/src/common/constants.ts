export const DEFAULT_START_DATE = '1900-01-01';

export const DEFAULT_DATE_DIFF = 2;

// Lambda executor will stop processing and return to avoid timeout error
export const EARLY_EXIT_THRESHOLD = 30 * 1000;

export const COMPENSATION_THRESHOLD = 5;

export const HIRED_THRESHOLD_MONTHS = 12;

export const FROM_OPPORTUNITIES = `
    FROM Opportunity app
        LEFT JOIN args ON true
        INNER JOIN Account accnt ON app.AccountID = accnt.ID
        LEFT JOIN Contact con ON con.AccountId = accnt.Id
        AND accnt.lastname NOT LIKE '%Test%'
        LEFT JOIN Application_Step_Result__c asr ON asr.applicationid__c = app.id
        AND asr.State__c IN (
            'Result_Passed',
            'Result_Failed',
            'Result_Failed_Retryable'
        )
        INNER JOIN Product2 pipe ON app.Pipeline__c = pipe.id
        AND pipe.Hourly_Rate__c >= args.compensationThreshold
        AND NOT pipe.Name LIKE '%Test Position%'
`;

export const FROM_ACCOUNTS_JOINS = `
    LEFT JOIN args ON true    
    INNER JOIN Opportunity app ON acc.accId = app.AccountId
    INNER JOIN Application_Step_Result__c asr ON asr.applicationid__c = app.id
    AND asr.State__c IN (
        'Result_Passed',
        'Result_Failed',
        'Result_Failed_Retryable'
    )
    INNER JOIN Application_Step__c appstep ON asr.application_step_id__c = appstep.id
    LEFT JOIN Badge_Proficiency__c prof ON asr.badge_earned__c = prof.id
    LEFT JOIN Badge_Proficiency__c prof2 ON appstep.id = prof2.Assessment__c
    AND asr.Badge_Simulated__c = 'Yes'
    AND asr.Score__c >= prof2.Pass_Threshold__c
`;

export const CANDIDATES_QUERY = `
suitable_accounts AS (
    SELECT app.Accountid AS accId,
        con.isemailbounced AS isEmailBounced,
        loc.country__c AS country,
        from_iso8601_timestamp(accnt.lastmodifieddate) AS accLastModifiedDate,
        from_iso8601_timestamp(app.lastmodifieddate) AS appLastModifiedDate,
        from_iso8601_timestamp(accnt.last_successful_login__c) AS lastActivity,
        accnt.timezone__c AS timezone,
        ARRAY [ pipe.name, pjt.job_title__c, pjt1.job_title__c ] AS jobTitles,
        app.amount AS amount,
        app.loss_reason__c AS lossReason,
        max (
                asr.signal_type__c = 'Fraud'
                AND asr.signal_confidence__c >= 80
        ) AS asrFraud,
        max (
            stagename = 'Hired'
            AND date_diff(
                'month',
                from_iso8601_timestamp(app.hired_date_time__c),
                current_timestamp
            ) < args.hiredThresholdMonths
        ) AS hired,
        max (
            accnt.personhasoptedoutofemail
            OR accnt.firstname = 'DELETED'
            OR UPPER (accnt.name) LIKE '%TEST%'
        ) AS notInterested
    ${FROM_OPPORTUNITIES}    
        LEFT JOIN location__c loc ON accnt.location__c = loc.id
        LEFT JOIN campaign camp ON camp.id = app.campaignid
        LEFT JOIN pipeline_job_title__c pjt on pjt.id = camp.pipeline_job_title__c
        LEFT JOIN job_board_cell__c jbc ON jbc.id = camp.job_board_cell__c
        LEFT JOIN pipeline_job_title__c pjt1 on pjt1.id = jbc.pipeline_job_title__c
    GROUP BY app.Id,
        app.Accountid,
        con.isemailbounced,
        loc.country__c,
        accnt.lastmodifieddate,
        accnt.timezone__c,
        app.lastmodifieddate,        
        ARRAY [ pipe.name,
        pjt.job_title__c,
        pjt1.job_title__c ],
        accnt.last_successful_login__c,
        app.amount,
        app.loss_reason__c
),
suitable_badges AS (
    SELECT acc.accId,
        acc.country,
        acc.isEmailBounced,
        max(acc.lastActivity) AS lastActivity,
        max(acc.timezone) AS timezone,
        min (acc.amount) AS rate,
        filter(acc.jobTitles, x->x IS NOT NULL) as jobTitles,
        filter(
            array_distinct(ARRAY_AGG(acc.lossReason)),
            x->x IS NOT NULL
        ) as lossReasons,
        appstep.id AS stepId,
        asrFraud,
        hired,
        notInterested,
        MAX (COALESCE (prof2.Stars__c, prof.Stars__c)) profStars
    FROM suitable_accounts acc        
        ${FROM_ACCOUNTS_JOINS}
    WHERE accLastModifiedDate > args.startDate OR appLastModifiedDate > args.startDate	
    GROUP BY acc.accId,
        acc.country,
        acc.isEmailBounced,
        acc.jobTitles,
        appstep.id,
        asrFraud,
        hired,
        notInterested
    HAVING MAX (COALESCE (prof2.Stars__c, prof.Stars__c)) IS NOT NULL
)
SELECT accId as candidateId,
    country,
    lastActivity,
    timezone as detectedTimezone,
    min(rate) as minCompPerHr,
    CAST(
        array_distinct(flatten(array_agg(jobTitles))) as JSON
    ) as jobTitles,
    CAST(
        array_distinct(
            ARRAY_AGG(
                CAST(
                    ROW(stepId, profStars) AS ROW (id VARCHAR, stars DECIMAL)
                )
            )
        ) as JSON
    ) badges,
    CASE
        WHEN max(
            arrays_overlap(
                lossReasons,
                ARRAY [ 'Rejected Proctored CCAT',
                'Rejected Blacklisted',
                'Rejected Duplicate Account' ]
            )
        )
        OR max(asrFraud) THEN 'blacklisted'
        WHEN max(hired) THEN 'hired'
        WHEN max(notInterested) THEN 'not-interested' ELSE 'available'
    END AS availability,
    isEmailBounced
FROM suitable_badges
GROUP BY accId,
    country,
    lastActivity,
    timezone,
    isEmailBounced
ORDER BY accId`;

export const PROFILES_QUERY = `
suitable_accounts AS (
    SELECT app.Accountid AS accId,
      accnt.description AS description,
      array_distinct(flatten(
      array_agg(filter(
        ARRAY [ ci.description__c,
                ci.institution__c,
                ci.what__c,
                ci.degree__c ],
                x->x IS NOT NULL
      )))
    ) AS candidateInfo,
    from_iso8601_timestamp(app.lastmodifieddate) AS appLastModifiedDate,
        max(from_iso8601_timestamp(ci.lastmodifieddate)) AS ciLastModifiedDate
    ${FROM_OPPORTUNITIES}
        LEFT JOIN candidate_information__c ci ON accnt.Id = ci.candidate__c 
    GROUP BY app.Accountid,
        accnt.description,
        app.lastmodifieddate               
)
, accounts_with_resumes AS (
    SELECT accId,
        array_join(
            filter(
            	ARRAY[description] || candidateInfo,
        	  	x-> x IS NOT NULL
            ),
            '\n',
            ''
        ) as resumeProfile,
        appLastModifiedDate,
        ciLastModifiedDate
    FROM suitable_accounts
    WHERE description IS NOT NULL OR cardinality(candidateInfo) > 0
)
SELECT acc.accId as candidateId, acc.resumeProfile
FROM accounts_with_resumes acc
    ${FROM_ACCOUNTS_JOINS}
WHERE (
        appLastModifiedDate > args.startDate
        OR ciLastModifiedDate > args.startDate
    )
GROUP BY acc.accId, acc.resumeProfile
HAVING MAX (COALESCE (prof2.Stars__c, prof.Stars__c)) IS NOT NULL
`;
