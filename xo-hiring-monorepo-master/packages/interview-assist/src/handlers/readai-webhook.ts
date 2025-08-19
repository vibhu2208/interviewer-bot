import { defaultLogger, Salesforce, SalesforceClient } from '@trilogy-group/xoh-integration';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DateTime } from 'luxon';
import { Sqs } from '../integrations/sqs';
import { ReadAiTranscript, ReadAIWebhookPayload } from '../models/read-ai-transcript';

const ClosestDaysThreshold = 2;

const log = defaultLogger({ serviceName: 'readai-webhook' });
Salesforce.silent();

export async function handleReadAiWebhook(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  log.resetKeys();
  log.info(`Received event`, {
    event: event,
  });
  try {
    // Parse the incoming event body
    const body: ReadAIWebhookPayload = JSON.parse(event.body ?? '{}');

    let interviewAsrId: string | null = null;
    // If graderId is provided, try to find the matching interview ASR for the grader
    const graderId = event.pathParameters?.graderId;
    if (graderId != null) {
      log.appendKeys({ graderId });
      interviewAsrId = await findMatchingInterviewASRByGraderId(body, graderId);
    } else {
      // Try to identify the matching interview ASR based on the emails
      log.info('Grader ID is not provided, will try to identify the matching interview ASR based on the emails');
      interviewAsrId = await findMatchingInterviewASRByEmails(body);
    }

    if (interviewAsrId != null) {
      log.appendKeys({ asrId: interviewAsrId });
      log.info(`Found matching interview ASR: ${interviewAsrId}`);

      // Check if transcript already exists
      const existingTranscript = await ReadAiTranscript.getById(interviewAsrId);
      if (existingTranscript) {
        const newDocumentId = `${interviewAsrId}#${body.session_id}`;
        log.error(
          `Transcript with ID ${interviewAsrId} for ${graderId} already exists in DynamoDB. Saving the document for the future fixes`,
          {
            newDocumentId,
          },
        );
        await ReadAiTranscript.insertNewWithId({
          payload: body,
          id: newDocumentId,
          asrId: interviewAsrId,
        });
      } else {
        log.info('No existing transcript found, will create a new one');
        await ReadAiTranscript.insertNew({
          payload: body,
          asrId: interviewAsrId,
        });

        // Send task to SQS for summary generation
        await Sqs.sendTask({ type: 'generate-summary', transcriptId: interviewAsrId });

        // Send task to SQS for interviewer onboarding
        await Sqs.sendTask({ type: 'onboard-interviewer', transcriptId: interviewAsrId });
      }
    } else {
      const hasInterviewKeyword = body.summary?.includes('interview');
      if (hasInterviewKeyword) {
        log.info('No matching interview ASR found, but possible Interview meeting', {
          meeting: {
            owner: body?.owner,
            participants: body?.participants,
            title: body?.title,
            url: body?.report_url,
          },
        });
      } else {
        log.debug('No matching interview ASR found, meeting data is not saved');
      }
    }
  } catch (error) {
    log.error('Failed to process callback', error as Error);
  }

  // Always return status 200 for read ai
  return {
    statusCode: 200,
    body: '{}',
  };
}

/**
 * Attempt to link interview received through the webhook with the interview ASR
 * @param readAiPayload
 */
async function findMatchingInterviewASRByEmails(readAiPayload: ReadAIWebhookPayload): Promise<string | null> {
  const ownerEmail = readAiPayload?.owner?.email;
  const participantsEmails = getParticipantsEmails(readAiPayload);

  if ((ownerEmail?.length ?? 0) === 0 || participantsEmails.length === 0) {
    log.warn('No owner or participants emails found in the payload');
    return null;
  }

  log.info(`Looking for matching interview ASR for ${ownerEmail} and ${participantsEmails}`);

  const sf = await Salesforce.getAdminClient();
  const events: CalendlyAction__c[] = await sf.querySOQL<CalendlyAction__c>(`
    SELECT 
      EventStartTime__c,
      ObjectId__c,
      EventPrimaryPublisherEmail__c,
      InviteeEmail__c,
      Name,
      EventUuid__c
    FROM CalendlyAction__c 
    WHERE 
      EventPrimaryPublisherEmail__c = '${ownerEmail}' 
      AND InviteeEmail__c IN (${participantsEmails.map((it) => `'${it}'`).join(',')})
      AND EventTypeName__c = 'Crossover Interview'
      AND EventStartTime__c = LAST_N_DAYS:2
    ORDER BY CreatedDate DESC 
  `);

  log.info(`Found ${events.length} events`);

  // Remove events with 'invitee.canceled' name for the same EventUuid
  // This will remove canceled events from the list
  // Even though we return not all the events (only last 2 days), the cancel will always be after the schedule
  const filteredEvents = events.filter(
    (event) => !events.some((e) => e.EventUuid__c === event.EventUuid__c && e.Name === 'invitee.canceled'),
  );

  log.info(`Filtered events to ${filteredEvents.length}`);

  // Find the event closest to the payload start time
  const payloadStartTime = DateTime.fromISO(readAiPayload.start_time);

  log.info(`Payload event start time is ${payloadStartTime.toISO()}`);

  const asrs = filteredEvents.map((it) => ({
    Id: it.ObjectId__c,
    Scheduled_For_Time__c: DateTime.fromISO(it.EventStartTime__c),
    Started_At_Time__c: null,
  }));

  const closestAsr = tryGetClosestAsr(asrs, payloadStartTime);
  return closestAsr?.Id ?? null;
}

/**
 * Attempt to link interview received through the webhook with the interview ASR
 * @param readAiPayload - The webhook payload
 * @param graderId - The grader ID from the path parameters
 */
async function findMatchingInterviewASRByGraderId(
  readAiPayload: ReadAIWebhookPayload,
  graderId?: string,
): Promise<string | null> {
  const participantsEmails = getParticipantsEmails(readAiPayload);

  if (graderId != null && participantsEmails.length > 0) {
    log.info(`Grader ID is provided, will use it to find potential matching interview ASR`);

    try {
      const sf = await Salesforce.getAdminClient();
      // Fetch all active interviews for the grader
      const activeInterviewASRs: Application_Step_Result__c[] = await sf.querySOQL<Application_Step_Result__c>(`
        SELECT Id, Scheduled_For_Time__c, Started_At_Time__c, ApplicationId__r.Account.PersonEmail
        FROM Application_Step_Result__c
        WHERE Grader__c = '${graderId}'
          AND Application_Stage__c = 'Interview'
          AND State__c IN ('Scheduled', 'Waiting for Grading')
        ORDER BY Scheduled_For_Time__c DESC NULLS FIRST
      `);

      log.info(`Found ${activeInterviewASRs.length} active interview ASRs for grader ${graderId}`, { graderId });
      if (activeInterviewASRs.length === 0) {
        return null;
      }

      // Filter ASRs by matching participant emails
      let participantInterviewASRs = activeInterviewASRs.filter((asr) =>
        participantsEmails.some(
          (email) => email.toLowerCase() === asr.ApplicationId__r.Account.PersonEmail?.toLowerCase(),
        ),
      );
      log.info(`Matched ${participantInterviewASRs.length} ASRs based on participant emails`, { graderId });

      if (participantInterviewASRs.length === 0) {
        participantInterviewASRs = await findMatchingASRsFromCalendlyActions(
          sf,
          activeInterviewASRs,
          participantsEmails,
          graderId,
        );
      }

      if (participantInterviewASRs.length === 0) {
        return null;
      }

      // Convert string dates to DateTime objects
      const asrRecords: ApplicationStepResult[] = participantInterviewASRs.map((asr) => ({
        Id: asr.Id,
        Scheduled_For_Time__c: asr.Scheduled_For_Time__c ? DateTime.fromISO(asr.Scheduled_For_Time__c) : null,
        Started_At_Time__c: asr.Started_At_Time__c ? DateTime.fromISO(asr.Started_At_Time__c) : null,
      }));

      // Find the event closest to the payload start time
      const payloadStartTime = DateTime.fromISO(readAiPayload.start_time);
      const matchingAsr = tryGetClosestAsr(asrRecords, payloadStartTime);

      if (matchingAsr != null) {
        log.appendKeys({ asrId: matchingAsr.Id });
        log.info(
          `Found closest matching ASR ${
            matchingAsr.Id
          } for grader ${graderId} within acceptable time range (payload start time: ${payloadStartTime.toISO()})`,
        );
        return matchingAsr.Id;
      } else {
        log.info('No suitable ASR found within acceptable time range');
        return null;
      }
    } catch (error) {
      log.error('Failed to find matching interview ASR for grader', { graderId, error });
    }
  }

  return null;
}

/**
 * Find matching ASRs by querying Calendly actions
 * @param sf - Salesforce client
 * @param activeInterviewASRs - List of active interview ASRs
 * @param participantsEmails - List of participant emails
 * @param graderId - Grader ID for logging
 * @returns List of matching ASRs
 */
async function findMatchingASRsFromCalendlyActions(
  sf: SalesforceClient,
  activeInterviewASRs: Application_Step_Result__c[],
  participantsEmails: string[],
  graderId: string,
): Promise<Application_Step_Result__c[]> {
  // Select events based on CalendlyActions
  const relatedCalendlyActions: CalendlyAction__c[] = await sf.querySOQL<CalendlyAction__c>(`
    SELECT 
      EventStartTime__c,
      EventPrimaryPublisherEmail__c,
      InviteeEmail__c,
      Name,
      EventUuid__c
    FROM CalendlyAction__c 
    WHERE ObjectId__c IN (${activeInterviewASRs.map((it) => `'${it.Id}'`).join(',')})
      AND EventTypeName__c = 'Crossover Interview'
    ORDER BY CreatedDate DESC 
  `);
  log.info(`Found ${relatedCalendlyActions.length} calendly actions for the active interview ASRs`, { graderId });

  if (relatedCalendlyActions.length === 0) {
    return [];
  }

  // Remove events with 'invitee.canceled' name for the same EventUuid
  const nonCanceledCalendlyActions = relatedCalendlyActions.filter(
    (event) =>
      !relatedCalendlyActions.some((e) => e.EventUuid__c === event.EventUuid__c && e.Name === 'invitee.canceled'),
  );

  log.info(
    `Filtered ${relatedCalendlyActions.length} calendly actions to ${nonCanceledCalendlyActions.length} non-canceled events`,
    { graderId },
  );

  // Filter calendly actions by matching participant emails
  const calendlyActionsWithMatchingParticipantEmails = nonCanceledCalendlyActions.filter((event) =>
    participantsEmails.some((email) => email.toLowerCase() === event.InviteeEmail__c?.toLowerCase()),
  );

  log.info(
    `Filtered ${nonCanceledCalendlyActions.length} calendly actions to ${calendlyActionsWithMatchingParticipantEmails.length} events with matching participant emails`,
    { graderId },
  );

  return activeInterviewASRs.filter((asr) =>
    calendlyActionsWithMatchingParticipantEmails.some((event) => event.ObjectId__c === asr.Id),
  );
}

function getParticipantsEmails(readAiPayload: ReadAIWebhookPayload): string[] {
  return readAiPayload?.participants?.map((it) => it.email).filter((it) => (it?.length ?? 0) > 0) ?? [];
}

function tryGetClosestAsr(asrs: ApplicationStepResult[], payloadStartTime: DateTime): ApplicationStepResult | null {
  type TimeField = 'Scheduled_For_Time__c' | 'Started_At_Time__c';

  // Helper function to find closest ASR by specified time field
  const findClosestByField = (field: TimeField): ApplicationStepResult | null => {
    const nonNullAsrs = asrs.filter((asr) => asr[field] != null);

    if (nonNullAsrs.length === 0) return null;

    const closestAsr = nonNullAsrs.reduce((closest, current) => {
      if (!closest) return current;

      const currentDiff = Math.abs(current[field]!.diff(payloadStartTime).as('days'));
      const closestDiff = Math.abs(closest[field]!.diff(payloadStartTime).as('days'));

      return currentDiff < closestDiff ? current : closest;
    });

    const timeDiff = Math.abs(closestAsr[field]!.diff(payloadStartTime).as('days'));
    // Ignore the records which the time difference above ClosestDaysThreshold days
    return timeDiff < ClosestDaysThreshold ? closestAsr : null;
  };

  // Try to find by scheduled time first
  const byScheduled = findClosestByField('Scheduled_For_Time__c');
  if (byScheduled) return byScheduled;

  // Then try by started time
  const byStarted = findClosestByField('Started_At_Time__c');
  if (byStarted) return byStarted;

  // If no suitable record found by either time, return the first null record if any
  return asrs.find((asr) => asr.Scheduled_For_Time__c == null && asr.Started_At_Time__c == null) ?? null;
}

interface CalendlyAction__c {
  EventStartTime__c: string; // The event time
  ObjectId__c: string; // ASR Id
  EventPrimaryPublisherEmail__c: string; // Owner Email
  InviteeEmail__c: string; // Participant Email
  Name: string; // invitee.created or invitee.canceled
  EventUuid__c: string; // Unique meeting id
}

interface Application_Step_Result__c {
  Id: string; // ASR Id
  Scheduled_For_Time__c: string; // ASR Scheduled For Time
  Started_At_Time__c: string; // ASR Started At Time
  ApplicationId__r: {
    Account: {
      PersonEmail: string | null;
    };
  };
}

interface ApplicationStepResult {
  Id: string; // ASR Id
  Scheduled_For_Time__c: DateTime | null; // ASR Scheduled For Time
  Started_At_Time__c: DateTime | null; // ASR Started At Time
}
