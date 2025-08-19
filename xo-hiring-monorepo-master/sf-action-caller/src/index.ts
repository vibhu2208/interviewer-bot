import { APIGatewayProxyEvent, EventBridgeEvent } from 'aws-lambda';
import { Method } from 'axios';
import { callbackGT, SFLite } from './SFLite';
import { ActionCallerConfig, ActionCallerConfigType, readConfig, ServiceAccountConfig2Type } from './configs';
import * as AWS from 'aws-sdk';

const DEFAULT_SUCCESS_RESULT = { statusCode: 200, body: 'ok' } as ActionResult;
const emptyInvocableInputs = { inputs: [{}] };

interface ActionResult {
  statusCode: number;
  body: string;
}

interface InternalEvent {
  action: string;
  vendor?: string;
  asrId?: string;
  method?: string;
  body?: string | null;
  contentType?: string;
}

export async function handler(event: APIGatewayProxyEvent | EventBridgeEvent<string, void>) {
  if (!process.env.SSM_PARAMETER_CONFIG || !process.env.SSM_PARAMETER_SERVICE_ACCOUNT) {
    throw new Error('Required env vars are missing: SSM_PARAMETER_CONFIG, SSM_PARAMETER_SERVICE_ACCOUNT');
  }

  const config = await readConfig(process.env.SSM_PARAMETER_CONFIG.split(','), false, ActionCallerConfigType);
  const serviceAccountConfig = await readConfig(
    process.env.SSM_PARAMETER_SERVICE_ACCOUNT.split(','),
    true,
    ServiceAccountConfig2Type,
  );

  const sfDefault = new SFLite({
    clientName: 'default',
    authServer: serviceAccountConfig.authEndpoint,
    apiServer: config.salesforceUrl,
    clientId: serviceAccountConfig.clientId,
    clientSecret: serviceAccountConfig.clientSecret,
    username: serviceAccountConfig.username,
    password: serviceAccountConfig.password + serviceAccountConfig.securityToken,
  });

  const sfVendor = new SFLite({
    clientName: 'vendor',
    authServer: serviceAccountConfig.authEndpoint,
    apiServer: config.salesforceUrl,
    clientId: serviceAccountConfig.clientId,
    clientSecret: serviceAccountConfig.clientSecret,
    username: serviceAccountConfig.vendorUsername,
    password: serviceAccountConfig.vendorPassword + serviceAccountConfig.vendorSecurityToken,
  });

  // E.g. "SurveyMonkey:HZMhA5 TrueNorth:TWLTiH"
  const apiSecrets = (config.apiSecrets || '').split(/\s+/g);

  let internalEvent: InternalEvent;

  if ('detail-type' in event && event['detail-type'] === 'Scheduled Event') {
    internalEvent = parseEventBridgeEvent(event);
  } else if ('requestContext' in event) {
    internalEvent = parseApiGatewayEvent(apiSecrets, event);
  } else {
    throw new Error('Unrecognized event format');
  }

  return dispatch(sfDefault, sfVendor, config, internalEvent);
}

async function dispatch(sfDefault: SFLite, sfVendor: SFLite, config: ActionCallerConfig, event: InternalEvent) {
  let response: ActionResult | null = null;

  response = await processIfApex(sfDefault, event.action);
  if (response != null) {
    return response;
  }

  response = await processIfGT(config.gtCriteriaCallbackUrl, event);
  if (response != null) {
    console.log(event);
    return response;
  }

  response = await processIfCallback(sfVendor, event);
  if (response != null) {
    return response;
  }

  throw new Error('Subscribed to an unrecognized event');
}

async function processIfApex(sfDefault: SFLite, action: string) {
  if (action === 'LaunchLoadRawApplications') {
    // WAS: -e "ACTION2CRON=0 0/1 * * * ?" -e "ACTION2NAME=apex/LaunchLoadRawApplicationsBatchable"
    await sfDefault.post(
      '/services/data/v49.0/actions/custom/apex/LaunchLoadRawApplicationsBatchable',
      emptyInvocableInputs,
    );
  } else if (action === 'LaunchProcessResumesBatchable') {
    // WAS: -e "ACTION3CRON=0 0/2 * * * ?" -e "ACTION3NAME=apex/LaunchProcessResumesBatchable
    await sfDefault.post(
      '/services/data/v49.0/actions/custom/apex/LaunchProcessResumesBatchable',
      emptyInvocableInputs,
    );
  } else if (action === 'LaunchLS_ProcessResumesBatchable') {
    // WAS: -e "ACTION3CRON=0 0/2 * * * ?" -e "ACTION3NAME=apex/LaunchLS_ProcessResumesBatchable
    await sfDefault.post(
      '/services/data/v49.0/actions/custom/apex/LaunchLS_ProcessResumesBatchable',
      emptyInvocableInputs,
    );
  } else if (action === 'LaunchLS_CreateRawAppsBatchable') {
    // WAS: -e "ACTION3CRON=0 0/2 * * * ?" -e "ACTION3NAME=apex/LaunchLS_CreateRawApplicationsBatchable
    await sfDefault.post(
      '/services/data/v49.0/actions/custom/apex/LaunchLS_CreateRawApplicationsBatchable',
      emptyInvocableInputs,
    );
  } else if (action === 'LaunchProcessCampaignMembership') {
    // WAS: -e "ACTION4CRON=0 0 0/5 * * ?" -e "ACTION4NAME=apex/LaunchProcessCampaignMembershipBatchable"
    await sfDefault.post(
      '/services/data/v49.0/actions/custom/apex/LaunchProcessCampaignMembershipBatchable',
      emptyInvocableInputs,
    );
  } else if (action === 'LISlotsLaunchAvgWeeklyApplicants') {
    // WAS: -e "ACTION5CRON=0 10 0/8 * * ?" -e "ACTION5NAME=apex/LinkedInSlots_LaunchAvgWeeklyApplicants"
    await sfDefault.post(
      '/services/data/v49.0/actions/custom/apex/LinkedInSlots_LaunchAvgWeeklyApplicants',
      emptyInvocableInputs,
    );
  } else if (action === 'LIEALaunchLoadClosedJobs') {
    // WAS: -e "ACTION1CRON=0 5 * * * ?" -e "ACTION1NAME=apex/LinkedInEA_LaunchLoadClosedJobs"
    await sfDefault.post(
      '/services/data/v49.0/actions/custom/apex/LinkedInEA_LaunchLoadClosedJobs',
      emptyInvocableInputs,
    );
  } else if (action === 'LIEALoadJobsToCampaign') {
    // WAS: -e "ACTION0CRON=0 0/15 * * * ?" -e "ACTION0NAME=apex/LinkedInEA_LoadJobsToCampaign"
    await sfDefault.post(
      '/services/data/v49.0/actions/custom/apex/LinkedInEA_LoadJobsToCampaign',
      emptyInvocableInputs,
    );
  } else if (action === 'PredictiveIndexTracker') {
    // Introduced as of LAMBDA-5209
    await sfDefault.runApex('PredictiveIndexTrackerBatchable.launch();');
  } else if (action === 'CleanupPushEvent') {
    // Introduced as of LAMBDA-5589
    await sfDefault.runApex('CleanupPushEventBatchable.launch();');
  } else if (action === 'CategoryJobApplicationBatchable') {
    // Introduced as of LAMBDA-81250
    await sfDefault.runApex('CategoryJobApplicationBatchable.execute();');
  } else {
    return null;
  }

  return DEFAULT_SUCCESS_RESULT;
}

async function processIfGT(gtCriteriaCallbackUrl: string, event: InternalEvent) {
  // GT orders will have "GT-" prefix
  const GT_INDEX = 3;
  if (event.vendor === 'Criteria' && (event.asrId as string).startsWith('GT-')) {
    const { status, data } = await callbackGT(
      `${gtCriteriaCallbackUrl}/${(event.asrId as string).substring(GT_INDEX)}`,
      event.method as Method,
      event.body,
      event.contentType ? { 'Content-Type': event.contentType } : {},
    );
    return {
      statusCode: status,
      body: typeof data === 'string' ? data : JSON.stringify(data),
    } as ActionResult;
  }

  return null;
}

async function processIfCallback(sfVendor: SFLite, event: InternalEvent) {
  const asrSuffix = event.asrId ? '/' + event.asrId : '';
  if (event.action === 'assessments/callback') {
    await checkVideoAskTranscription(event);
    const { status, data } = await sfVendor.request(
      `/services/apexrest/assessments/v1/${event.vendor}${asrSuffix}`,
      event.method as Method,
      event.body,
      // Note: we cannot pass undefined for a missing header
      event.contentType ? { 'Content-Type': event.contentType } : {},
    );
    return {
      statusCode: status,
      body: typeof data === 'string' ? data : JSON.stringify(data),
    } as ActionResult;
  }

  if (event.action === 'proctoring/callback') {
    const { status, data } = await sfVendor.request(
      `/services/apexrest/proctoring/v1/${event.vendor}${asrSuffix}`,
      event.method as Method,
      event.body,
      // Note: we cannot pass undefined for a missing header
      event.contentType ? { 'Content-Type': event.contentType } : {},
    );
    return {
      statusCode: status,
      body: typeof data === 'string' ? data : JSON.stringify(data),
    } as ActionResult;
  }

  return null;
}

function requireApiSecret(apiSecrets: string[], providedSecret?: string) {
  if (!providedSecret) {
    throw new Error('API secret is missing');
  }

  if (apiSecrets.indexOf(providedSecret) === -1) {
    throw new Error('API secret is not valid');
  }
}

function parseApiGatewayEvent(apiSecrets: string[], event: APIGatewayProxyEvent) {
  // Decode base64-encoded payload
  event.body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : null;
  event.isBase64Encoded = false;

  // Normalize headers manually
  const headers: Record<string, string | undefined> = {};
  for (const key of Object.keys(event.headers)) {
    headers[key.toLowerCase()] = event.headers[key];
  }

  const assessmentsCallbackPrefix = '/assessments/callback';
  if (event.path.startsWith(assessmentsCallbackPrefix)) {
    requireApiSecret(apiSecrets, event.pathParameters?.apiSecret);
    return {
      action: 'assessments/callback',
      vendor: event.pathParameters?.vendor,
      asrId: event.pathParameters?.asrId,
      method: event.httpMethod,
      body: event.body,
      contentType: headers['content-type'],
    };
  }

  const proctoringCallbackPrefix = '/assessments/proctoring-callback';
  if (event.path.startsWith(proctoringCallbackPrefix)) {
    requireApiSecret(apiSecrets, event.pathParameters?.apiSecret);
    return {
      action: 'proctoring/callback',
      vendor: event.pathParameters?.vendor,
      asrId: event.pathParameters?.asrId,
      method: event.httpMethod,
      body: event.body,
      contentType: headers['content-type'],
    };
  }

  throw new Error(`Route ${event.path} is not recognized`);
}

async function checkVideoAskTranscription(event: InternalEvent) {
  try {
    if (event.vendor?.toLowerCase() !== 'videoask') {
      return;
    }

    // Parse the body as JSON and get the event type
    const eventBody = JSON.parse(event.body as string);
    const eventType = eventBody?.event_type;
    if (eventType !== 'form_response_transcribed') {
      // We are not interested in any other events
      return;
    }

    const asrId = eventBody.contact?.variables?.token;
    if (asrId == null) {
      console.error('Received no asrId for videoask, nothing to save');
      return;
    }

    // Extract the transcript data for every question and store it as a single string
    const transcript = eventBody?.contact?.answers
      ?.map((it: any) => it.transcription)
      ?.filter((it: any) => it != null && it.trim().length > 0)
      ?.join('\n\n');
    if (transcript == null || transcript.trim().length === 0) {
      console.error(`Received empty transcript for videoask, nothing to save: ${asrId}`);
      return;
    }

    // Save the transcript to the S3 bucket
    const s3 = new AWS.S3();
    await s3
      .putObject({
        Body: transcript,
        Bucket: process.env.VIDEOASK_BUCKET_NAME as string,
        Key: `transcripts/${asrId}.txt`,
      })
      .promise();
  } catch (e) {
    console.error('Error while checking VideoAsk transcription', e);
  }
}

function parseEventBridgeEvent(event: EventBridgeEvent<string, void>) {
  if (event.resources.length !== 1) {
    throw new Error('Unexpected format of the EventBridge event. "resources" size is not 1');
  }

  const match = event.resources[0].match(/:rule\/xo-hiring-(\w+-?)+$/);

  if (!match || !match[1]) {
    throw new Error(`Unexpected format of the EventBridge event: "${event.resources[0]}"`);
  }

  return {
    action: match[1],
  };
}
