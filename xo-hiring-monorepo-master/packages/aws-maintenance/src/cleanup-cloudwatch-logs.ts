import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  DeleteLogGroupCommand,
  PutRetentionPolicyCommand,
  ThrottlingException,
  DescribeLogStreamsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { defaultLogger } from '@trilogy-group/xoh-integration';
import { sleep } from './utils/env-classifier';
import { classifyEnvironment } from './utils/env-classifier';
import { DateTime } from 'luxon';

const PREVIEW_RETENTION_DAYS = 7;
const SANDBOX_RETENTION_DAYS = 120;
const PRODUCTION_RETENTION_DAYS = 180;
const OLD_LOG_GROUP_THRESHOLD_DAYS = 180;

const log = defaultLogger({
  logLevel: 'debug',
});
const client = new CloudWatchLogsClient({ region: 'us-east-1' });

/**
 * Performs a cleanup for the cloudwatch log groups
 *  - Preview log groups removed if older than one week
 *  - Sandbox log groups set to have retention 4 months
 *  - Production log groups set to have retention 6 months
 *  - Old log groups (created > 6 months before) without any events are removed
 */
export async function cleanupCloudwatchLogs() {
  const oneWeekAgo = DateTime.now().minus({ days: PREVIEW_RETENTION_DAYS });
  const oldLogGroupThreshold = DateTime.now().minus({ days: OLD_LOG_GROUP_THRESHOLD_DAYS });

  // Track log groups older than 180 days
  const oldLogGroups: string[] = [];

  let nextToken: string | undefined;
  do {
    const command = new DescribeLogGroupsCommand({ nextToken });
    const response = await client.send(command);
    if (response.logGroups == null) {
      continue;
    }

    for (const logGroup of response.logGroups) {
      if (logGroup.logGroupName == null) {
        continue;
      }

      // Track old log groups to check later
      if (logGroup.creationTime && DateTime.fromMillis(logGroup.creationTime) <= oldLogGroupThreshold) {
        oldLogGroups.push(logGroup.logGroupName);
      }

      try {
        const { classification } = classifyEnvironment(logGroup.logGroupName);
        switch (classification) {
          case 'preview': {
            if (logGroup.creationTime && DateTime.fromMillis(logGroup.creationTime) < oneWeekAgo) {
              await client.send(new DeleteLogGroupCommand({ logGroupName: logGroup.logGroupName }));
              log.debug(`Deleted log group: ${logGroup.logGroupName}`);
            }
            break;
          }
          case 'production':
          case 'sandbox': {
            if (!logGroup.retentionInDays) {
              const retentionInDays =
                classification === 'production' ? PRODUCTION_RETENTION_DAYS : SANDBOX_RETENTION_DAYS;
              await client.send(
                new PutRetentionPolicyCommand({ logGroupName: logGroup.logGroupName, retentionInDays }),
              );
              log.info(
                `Set retention to ${retentionInDays} days for ${classification} log group: ${logGroup.logGroupName}`,
              );
            } else {
              log.debug(`${classification} log group already has retention set: ${logGroup.logGroupName}`);
            }
            break;
          }
          default: {
            if (!logGroup.retentionInDays) {
              log.info(`Env classification is not possible, applying prod retention rules: ${logGroup.logGroupName}`);
              await client.send(
                new PutRetentionPolicyCommand({
                  logGroupName: logGroup.logGroupName,
                  retentionInDays: PRODUCTION_RETENTION_DAYS,
                }),
              );
            } else {
              log.debug(`Env classification is not possible, retention is already applied: ${logGroup.logGroupName}`);
            }
          }
        }
      } catch (e) {
        if (e instanceof ThrottlingException) {
          log.warn(`Caught throttling exception, sleeping for 10 seconds: ${e}`);
          await sleep(10000);
        } else {
          throw e;
        }
      }
    }

    nextToken = response.nextToken;
  } while (nextToken);

  // Check old log groups for streams and delete if empty
  log.info(`Checking ${oldLogGroups.length} log groups older than ${OLD_LOG_GROUP_THRESHOLD_DAYS} days for emptiness`);
  for (const logGroupName of oldLogGroups) {
    try {
      // Check if the log group has any streams
      const streamsCommand = new DescribeLogStreamsCommand({
        logGroupName,
        limit: 1, // We only need to know if at least one stream exists
      });

      const streamsResponse = await client.send(streamsCommand);

      if (!streamsResponse.logStreams || streamsResponse.logStreams.length === 0) {
        // Log group is empty, delete it
        await client.send(new DeleteLogGroupCommand({ logGroupName }));
        log.info(`Deleted empty log group older than ${OLD_LOG_GROUP_THRESHOLD_DAYS} days: ${logGroupName}`);
      } else {
        log.debug(`Old log group has streams, keeping: ${logGroupName}`);
      }
    } catch (e) {
      if (e instanceof ThrottlingException) {
        log.warn(`Caught throttling exception, sleeping for 10 seconds: ${e}`);
        await sleep(10000);
        // Re-add to the beginning of the array to retry
        oldLogGroups.unshift(logGroupName);
      } else {
        log.error(`Error checking log group ${logGroupName}: ${e}`);
      }
    }
  }
}

if (require.main === module) {
  cleanupCloudwatchLogs().catch(console.error);
}
