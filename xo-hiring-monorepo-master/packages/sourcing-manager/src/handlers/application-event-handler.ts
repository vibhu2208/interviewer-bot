import { SQSEvent, SQSRecord, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { defaultLogger } from '@trilogy-group/xoh-integration';
import { IndeedApiClient, DispositionStatus, DispositionInput } from '../integrations/indeed';
import { DateTime } from 'luxon';

const log = defaultLogger({ serviceName: 'application-event-handler' });
const TerminalApplicationStages = ['Hired', 'Canceled', 'Expired', 'Marketplace', 'Rejected'];
const MaxBatchSize = 25;

/**
 * Lambda handler for processing application events from Salesforce via EventBridge and SQS
 *
 * @param event SQS event containing application status events from Salesforce
 * @returns SQS batch response with any failed message IDs
 */
export async function handleApplicationEvents(event: SQSEvent): Promise<SQSBatchResponse> {
  log.info(`Processing ${event.Records.length} SQS event records`);

  const failedMessageIds: SQSBatchItemFailure[] = [];
  const allDispositionUpdates: DispositionInput[] = [];

  // Step 1: Collect all disposition updates from all SQS records (synchronous)
  for (const record of event.Records) {
    try {
      const recordDispositionUpdates = processApplicationEventRecord(record);
      allDispositionUpdates.push(...recordDispositionUpdates);
      log.debug(`Successfully processed record with messageId: ${record.messageId}`);
    } catch (error) {
      log.error(`Failed to process record with messageId: ${record.messageId}`, error as Error);
      failedMessageIds.push({
        itemIdentifier: record.messageId,
      });
    }
  }

  // Step 2: Send all disposition updates to Indeed in batches (only if no record failures)
  if (allDispositionUpdates.length > 0) {
    try {
      await sendDispositionUpdatesBatched(allDispositionUpdates);
      log.info(`Successfully sent all disposition updates to Indeed`);
    } catch (error) {
      log.error(`Failed to send disposition updates to Indeed API`, { error });
      // Mark all records as failed if we can't send to Indeed
      failedMessageIds.push(
        ...event.Records.map((record) => ({
          itemIdentifier: record.messageId,
        })),
      );
    }
  } else {
    log.info('No disposition updates to send to Indeed across all records');
  }

  return {
    batchItemFailures: failedMessageIds,
  };
}

/**
 * Process a single SQS record containing an application event
 *
 * @param record SQS record containing the application event data
 * @returns Array of disposition updates collected from this record
 */
function processApplicationEventRecord(record: SQSRecord): DispositionInput[] {
  try {
    // Parse the EventBridge event from the SQS message body
    const eventBridgeEvent: EventBridgeEvent = JSON.parse(record.body);
    if (eventBridgeEvent['detail-type'] !== 'ApplicationStageChange__e') {
      log.warn(`Unhandled event type received from the Salesforce: ${eventBridgeEvent['detail-type']}`);
      return [];
    }

    // Extract and parse the Salesforce payload
    const applicationChanges: ApplicationStageChange[] = JSON.parse(eventBridgeEvent.detail.payload.Payload__c);
    log.info(`Processing ${applicationChanges.length} application stage changes`);

    // Collect all disposition updates synchronously (no API calls)
    const allDispositionUpdates: DispositionInput[] = [];

    for (const change of applicationChanges) {
      const dispositionUpdates = collectDispositionUpdates(change, record.messageId);
      allDispositionUpdates.push(...dispositionUpdates);
    }

    log.info(`Collected ${allDispositionUpdates.length} disposition updates from record ${record.messageId}`);
    return allDispositionUpdates;
  } catch (error) {
    log.error(`Failed to parse application event - messageId: ${record.messageId}`, {
      error,
    });
    throw error;
  }
}

/**
 * Collect disposition updates for a single application stage change (synchronous)
 *
 * @param change Application stage change containing old and updated application data
 * @param messageId SQS message ID for logging
 * @returns Array of disposition updates to send to Indeed
 */
function collectDispositionUpdates(change: ApplicationStageChange, messageId: string): DispositionInput[] {
  const { updated, old } = change;
  const logContext = { applicationId: change.updated.Id, messageId };

  log.info(`Collecting disposition updates for application Id: ${updated.Id}`, {
    ...logContext,
    updated,
    old,
  });

  // Filter for Indeed applications only
  if (updated.Sourcing_Platform__c !== 'Indeed') {
    log.debug(`Skipping non-Indeed application: ${updated.Id}`, logContext);
    return [];
  }

  // Check if we have an Indeed Apply ID
  if (!updated.ExternalId__c) {
    log.warn(`Missing ExternalId__c (Indeed Apply ID) for application: ${updated.Id}`, logContext);
    return [];
  }

  // Determine disposition statuses
  const dispositionStatuses = determineDispositionStatuses(updated, old);
  if (dispositionStatuses.length === 0) {
    log.debug(`No disposition status changes needed for application: ${updated.Id}`, logContext);
    return [];
  }

  // Convert Salesforce timestamp to RFC3339 format
  const parsedDateTime = DateTime.fromISO(updated.SystemModstamp);
  const rfc3339Timestamp = parsedDateTime.isValid ? parsedDateTime.toISO() : DateTime.now().toISO();

  // Convert to DispositionInput objects
  const dispositionUpdates: DispositionInput[] = dispositionStatuses.map((status) => ({
    dispositionStatus: status,
    indeedApplyID: updated.ExternalId__c,
    atsName: 'Crossover',
    statusChangeDateTime: rfc3339Timestamp,
  }));

  log.debug(`Generated ${dispositionUpdates.length} disposition updates for application: ${updated.Id}`, {
    ...logContext,
    dispositionStatuses: dispositionStatuses,
    indeedApplyID: updated.ExternalId__c,
  });

  return dispositionUpdates;
}

/**
 * Send disposition updates to Indeed API in batches of 25
 *
 * @param dispositionUpdates Array of all disposition updates to send
 */
async function sendDispositionUpdatesBatched(dispositionUpdates: DispositionInput[]): Promise<void> {
  const totalUpdates = dispositionUpdates.length;

  log.info(`Sending ${totalUpdates} disposition updates to Indeed in batches of ${MaxBatchSize}`);

  let successfulUpdates = 0;
  let failedUpdates = 0;

  // Process updates in batches
  for (let i = 0; i < dispositionUpdates.length; i += MaxBatchSize) {
    const batch = dispositionUpdates.slice(i, i + MaxBatchSize);
    const batchNumber = Math.floor(i / MaxBatchSize) + 1;
    const totalBatches = Math.ceil(totalUpdates / MaxBatchSize);

    log.info(`Processing batch ${batchNumber}/${totalBatches} with ${batch.length} updates`, {
      batch,
    });

    try {
      const indeedClient = await IndeedApiClient.default();
      const result = await indeedClient.sendDispositionStatus(batch);

      successfulUpdates += result.numberGoodDispositions;
      failedUpdates += result.failedDispositions.length;

      log.info(`Batch ${batchNumber}/${totalBatches} completed`, {
        batchNumber,
        totalBatches,
        batchSize: batch.length,
        successfulInBatch: result.numberGoodDispositions,
        failedInBatch: result.failedDispositions.length,
        failedDispositions: result.failedDispositions,
      });

      // Log individual failures if any
      if (result.failedDispositions.length > 0) {
        for (const failure of result.failedDispositions) {
          log.warn(`Failed to send disposition for Indeed Apply ID: ${failure.identifiedBy.indeedApplyID}`, {
            indeedApplyID: failure.identifiedBy.indeedApplyID,
            rationale: failure.rationale,
          });
        }
      }
    } catch (error) {
      log.error(`Failed to send batch ${batchNumber}/${totalBatches} to Indeed API`, {
        batchNumber,
        totalBatches,
        batchSize: batch.length,
        error,
      });

      // Count all items in failed batch as failed
      failedUpdates += batch.length;

      // Re-throw to mark the entire SQS message as failed
      throw error;
    }
  }

  log.info(`Completed sending disposition updates to Indeed`, {
    totalUpdates,
    successfulUpdates,
    failedUpdates,
  });
}

/**
 * Determine the Indeed disposition status based on application stage changes
 *
 * @param updated Updated application data
 * @param old Previous application data (null for new applications)
 * @returns Array of disposition status updates that should be sent to Indeed
 */
function determineDispositionStatuses(updated: Application, old: Application | null): DispositionStatus[] {
  if (old == null) {
    return [DispositionStatus.NEW];
  }

  // Handle stage changes
  const oldStage = old.StageName;
  const newStage = updated.StageName;

  // Stage change events
  if (oldStage !== newStage) {
    switch (newStage) {
      case 'BFQ':
        return [DispositionStatus.SCREEN];
      case 'Review':
        return [DispositionStatus.REVIEW];
      case 'Interview':
        return [DispositionStatus.INTERVIEW];
      case 'Offer':
        return [DispositionStatus.OFFER_MADE];
      case 'Fraud Check':
        return [DispositionStatus.BACKGROUND_CHECK];
      case 'Hired':
        return [DispositionStatus.HIRED];
      case 'Canceled': {
        const statuses = [DispositionStatus.NOT_SELECTED];
        switch (updated.Loss_Reason__c) {
          case 'Canceled by Candidate':
            statuses.push(DispositionStatus.WITHDRAWN);
            break;
          case 'Canceled Pipeline Closed':
            statuses.push(DispositionStatus.JOB_CLOSED);
            break;
        }
        return statuses;
      }
      case 'Expired':
      case 'Marketplace':
      case 'Rejected':
        return [DispositionStatus.NOT_SELECTED];
      default: {
        if (oldStage === 'BFQ' && !TerminalApplicationStages.includes(newStage)) {
          return [DispositionStatus.POSITIVELY_SCREENED];
        }
      }
    }
  }
  return [];
}

interface Application {
  Id: string;
  ExternalId__c: string;
  Sourcing_Platform__c?: string;
  StageName: string;
  Loss_Reason__c?: string;
  Last_Active_Stage__c?: string;
  SystemModstamp: string;
}

interface ApplicationStageChange {
  updated: Application;
  old: Application | null;
}

interface EventBridgeEvent {
  version: string;
  id: string;
  'detail-type': string;
  source: string;
  account: string;
  time: string;
  region: string;
  detail: {
    payload: {
      CreatedById: string;
      Payload__c: string;
      CreatedDate: string;
    };
    schemaId: string;
    id: string;
  };
}
