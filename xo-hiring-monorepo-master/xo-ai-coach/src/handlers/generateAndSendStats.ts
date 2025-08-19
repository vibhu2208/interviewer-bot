import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DateTime } from 'luxon';
import Handlebars from 'handlebars';
import { Config } from '../config';
import { Athena } from '../integrations/athena';
import { Email } from '../integrations/email';
import { Ssm } from '../integrations/ssm';
import { EmailTemplate } from '../template';

interface Input {
  from: string;
}

function determineInputEvent(event: Input | APIGatewayProxyEventV2): Input {
  // Determine if invoked via function url
  if ('version' in event) {
    return JSON.parse(event.body ?? '{}');
  } else {
    return event;
  }
}

export async function handler(event: Input | APIGatewayProxyEventV2): Promise<void> {
  const input = determineInputEvent(event);

  // Start of the last week
  let startDate = DateTime.now().startOf('week').minus({ week: 1 });
  if (input.from != null) {
    startDate = DateTime.fromISO(input.from);
    console.log(`Start date override from input: ${startDate.toISODate()}`);
  } else {
    console.log(`Determined start date: ${startDate.toISODate()}`);
  }

  const config = await Ssm.getForEnvironment();
  console.log(`Loaded SSM configuration`);

  // Determine template
  let templateSource = EmailTemplate;
  try {
    const s3 = new S3Client({
      region: Config.getRegion(),
    });
    const existingFile = await s3.send(
      new GetObjectCommand({
        Bucket: Config.getDataBucketName(),
        Key: 'email-template.html',
      }),
    );
    if (existingFile.Body != null) {
      templateSource = await existingFile.Body.transformToString('utf-8');
      console.log(`Fetched email template from the data bucket`);
    }
  } catch (e) {
    // File is not found in bucket
    console.log(`Email template override is not detected: ${e}`);
  }

  const emailTemplate = Handlebars.compile(templateSource);
  const email = await Email.getTransporter();

  // Query the data from athena
  const tableName = Config.getAthenaTable();
  const dateFrom = startDate.toISODate() as string;

  const users = await getAllUsers(tableName, dateFrom);
  const perUserData = await getPerUserData(tableName, dateFrom);
  const perTeamData = await getPerTeamData(tableName, dateFrom);
  const globalData = await getGlobalData(tableName, dateFrom);
  const perTeamToolUsageData = await getPerTeamTopToolUsageData(tableName, dateFrom);

  for (const user of users) {
    if (config.whitelistTeamIds != null && config.whitelistTeamIds.length > 0) {
      if (!config.whitelistTeamIds.includes(parseInt(user.teamId))) {
        console.log(`User ${user.userName} does not belong to whitelisted team (${user.teamId})`);
        continue;
      }
    }
    const userRows = perUserData.filter((it) => it.userId === user.userId);

    const context: any = {
      userId: user.userId,
      userName: user.userName,
      companyEmail: user.companyEmail,
      totalTimeSpent: userRows.length > 0 ? toHours(userRows[0].totalTimeSpent) : 0,
      userApplications: userRows.map((it) => ({ name: it.applicationName, time: toHours(it.timeSpentPerApplication) })),
      teamId: user.teamId,
      teamName: user.teamName,
    };

    if (context.companyEmail == null || context.companyEmail.length === 0) {
      console.log(`User ${context.userName} does not have company email defined`);
      continue;
    }

    const teamData = perTeamData.filter((it) => it.teamId === context.teamId);
    if (teamData.length > 0) {
      const teamTopToolData = perTeamToolUsageData.filter((it) => it.teamId === teamData[0].teamId) ?? [];
      context.teamAverageUsage = toHours(parseInt(teamData[0].totalTimeSpent, 10) / parseInt(teamData[0].teamSize, 10));
      context.teamTopUsers = teamData.map((it) => ({ name: it.userName, time: toHours(it.totalTimeSpent) }));
      context.teamSize = teamData[0].teamSize;
      context.teamTopToolData = teamTopToolData.map((it) => ({
        name: it.applicationName,
        time: toHours(it.timeSpent),
      }));
    }

    context.globalApps = globalData.globalUsage.map((it) => ({
      name: it.applicationName,
      time: toHours(it.totalTimeSpent),
    }));
    context.globalUsage = {
      avgTop10Percent: toHours(globalData.percentileUsage.avgTop10Percent),
      avgTop50Percent: toHours(globalData.percentileUsage.avgTop50Percent),
    };

    try {
      console.log(`Sending email with results to ${context.companyEmail}`);
      await email.sendMail({
        from: 'Crossover No-Reply <noreply@crossover.com>',
        to: context.companyEmail,
        subject: `Your weekly AI usage statistics`,
        html: emailTemplate(context),
        bcc: 'ai.coach@crossover.com',
        ses: {
          FromArn: Config.getEmailIdentity(),
          ConfigurationSetName: Config.getEmailConfigurationSet(),
          Tags: [
            {
              Name: 'TAG',
              Value: 'AI_COACH',
            },
          ],
        },
      } as any);
    } catch (e) {
      console.error(`Error while sending email`, e);
    }
  }
}

async function getGlobalData(tableName: string, dateFrom: string): Promise<GlobalData> {
  const globalQuery = `
SELECT 
    applicationname AS applicationName, 
    SUM(spenttime) AS totalTimeSpent
FROM ${tableName}
WHERE CAST(dt as DATE) BETWEEN CAST('${dateFrom}' AS DATE) AND DATE_ADD('day', 7, CAST('${dateFrom}' AS DATE))
      AND sectionname = 'AI'
GROUP BY applicationname
ORDER BY totalTimeSpent DESC LIMIT 10;
  `.trim();
  const globalUsage = await Athena.query<GlobalDataRow>(globalQuery);

  const percentileUsageQuery = `
WITH GlobalUsage AS (
    SELECT 
        userid, 
        SUM(spenttime) AS total_time,
        NTILE(10) OVER (ORDER BY SUM(spenttime) DESC) AS decile,
        NTILE(2) OVER (ORDER BY SUM(spenttime) DESC) AS half
    FROM ${tableName}
    WHERE CAST(dt as DATE) BETWEEN CAST('${dateFrom}' AS DATE) AND DATE_ADD('day', 7, CAST('${dateFrom}' AS DATE))
          AND sectionname = 'AI'
    GROUP BY userid
)
SELECT 
    AVG(CASE WHEN decile = 1 THEN total_time ELSE NULL END) AS avgTop10Percent,
    AVG(CASE WHEN half = 1 THEN total_time ELSE NULL END) AS avgTop50Percent
FROM GlobalUsage;
  `.trim();
  const percentileUsage: { avgTop10Percent: string; avgTop50Percent: string }[] = await Athena.query(
    percentileUsageQuery,
  );

  return {
    globalUsage,
    percentileUsage: percentileUsage[0],
  };
}

interface GlobalData {
  globalUsage: GlobalDataRow[];
  percentileUsage: {
    avgTop10Percent: string;
    avgTop50Percent: string;
  };
}

interface GlobalDataRow {
  applicationName: string;
  totalTimeSpent: string;
}

async function getPerTeamData(tableName: string, dateFrom: string): Promise<TeamDataRow[]> {
  const perTeamQuery = `
WITH TeamUsage AS (
    SELECT 
        teamname, 
        teamid,
        userid,
        username,
        SUM(spenttime) AS total_time,
        RANK() OVER (PARTITION BY teamid ORDER BY SUM(spenttime) DESC) AS user_rank,
        COUNT(*) OVER (PARTITION BY teamid) AS team_size
    FROM ${tableName}
    WHERE CAST(dt as DATE) BETWEEN CAST('${dateFrom}' AS DATE) AND DATE_ADD('day', 7, CAST('${dateFrom}' AS DATE))
          AND sectionname = 'AI'
    GROUP BY teamid, teamname, userid, username
)
SELECT 
    teamname AS teamName, 
    teamid AS teamId,
    userid AS userId,
    username AS userName,
    total_time AS totalTimeSpent,
    team_size AS teamSize
FROM TeamUsage
WHERE user_rank <= 3;
  `.trim();

  return await Athena.query<TeamDataRow>(perTeamQuery);
}

interface TeamDataRow {
  teamId: string;
  teamName: string;
  userId: string;
  userName: string;
  totalTimeSpent: string;
  teamSize: string;
}

async function getPerTeamTopToolUsageData(tableName: string, dateFrom: string): Promise<TeamTopToolUsageData[]> {
  const perTeamTopToolUsageQuery = `
  WITH RankedApps AS (
      SELECT 
           teamid,
           applicationname,
           SUM(spenttime) AS total_spent_time,
           ROW_NUMBER() OVER (PARTITION BY teamid ORDER BY SUM(spenttime) DESC) as rank
      FROM ${tableName}
      WHERE CAST(dt as DATE) BETWEEN CAST('${dateFrom}' AS DATE) AND DATE_ADD('day', 7, CAST('${dateFrom}' AS DATE))
            AND sectionname = 'AI'
      GROUP BY teamid, applicationname
  ) SELECT teamid AS teamId, applicationname as applicationName, total_spent_time as timeSpent FROM RankedApps WHERE rank <= 5
  `.trim();

  return await Athena.query<TeamTopToolUsageData>(perTeamTopToolUsageQuery);
}

interface TeamTopToolUsageData {
  teamId: string;
  applicationName: string;
  timeSpent: string;
}

interface UserInfoRow {
  userId: string;
  companyEmail: string;
  userName: string;
  teamId: string;
  teamName: string;
}

async function getAllUsers(tableName: string, dateFrom: string): Promise<UserInfoRow[]> {
  const allUsersQuery = `
SELECT 
    userid as userId,
    companyemail as companyEmail,
    username as userName, 
    teamid as teamId,
    teamname as teamName
FROM ${tableName}
WHERE CAST(dt as DATE) BETWEEN CAST('${dateFrom}' AS DATE) AND DATE_ADD('day', 7, CAST('${dateFrom}' AS DATE))
GROUP BY userId, companyEmail, userName, teamId, teamName
ORDER BY userId ASC  
  `.trim();

  return await Athena.query<UserInfoRow>(allUsersQuery);
}

async function getPerUserData(tableName: string, dateFrom: string): Promise<UserDataRow[]> {
  const perUserDataQuery = `
WITH UserTotalTime AS (
    SELECT 
        userid,
        SUM(spenttime) AS total_time_spent
    FROM ${tableName}
    WHERE CAST(dt as DATE) BETWEEN CAST('${dateFrom}' AS DATE) AND DATE_ADD('day', 7, CAST('${dateFrom}' AS DATE))
          AND sectionname = 'AI'
    GROUP BY userid
),
Top5ToolsPerUser AS (
    SELECT 
        userid, 
        applicationname, 
        SUM(spenttime) AS time_spent,
        RANK() OVER (PARTITION BY userid ORDER BY SUM(spenttime) DESC) AS rank
    FROM ${tableName}
    WHERE CAST(dt as DATE) BETWEEN CAST('${dateFrom}' AS DATE) AND DATE_ADD('day', 7, CAST('${dateFrom}' AS DATE))
          AND sectionname = 'AI'
    GROUP BY userid, applicationname
)
SELECT 
    u.userid as userId,
    u.total_time_spent AS totalTimeSpent,
    t.applicationname as applicationName, 
    t.time_spent as timeSpentPerApplication
FROM Top5ToolsPerUser t
JOIN UserTotalTime u ON t.userid = u.userid
WHERE t.rank <= 5;
  `.trim();

  return await Athena.query<UserDataRow>(perUserDataQuery);
}

interface UserDataRow {
  userId: string;
  totalTimeSpent: string;
  applicationName: string;
  timeSpentPerApplication: string;
}

function toHours(num: number | string): number {
  num = typeof num === 'string' ? parseInt(num, 10) : num;
  return num > 0 ? Math.max(0.1, roundTo(num / 60, 1)) : 0;
}

function roundTo(num: number, digits: number): number {
  const multiplier = Math.pow(10, digits);
  return Math.round(num * multiplier) / multiplier;
}
