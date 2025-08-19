import { AxiosError } from 'axios';
import {
  StateMachineStep,
  ExporterLambdaEventType,
  StateMachineData,
  getSecrets,
  OwnBackupDataSecrets,
  ExporterLambdaEvent,
} from './helper';
import { OwnDataClient } from './owndata-client';
import { StepFunctions } from './step-functions';

// Timeout after 18 hours waiting for backup job
const BackupJobTimeoutThresholdHours = 18;
const MsInHour = 3_600_000;
const OwnDataRegionalDomain = 'app1.owndata.com';

export async function handler(eventArg: ExporterLambdaEvent) {
  try {
    const event = ExporterLambdaEventType.parse(eventArg);
    const secret = await getSecrets();

    switch (event.step) {
      case StateMachineStep.ProtectAgainstDuplicateRun:
        return await protectAgainstDuplicateRun(event.data);
      case StateMachineStep.GetLastBackupJobStatus:
        return await getLastBackupJobStatus(event.data, secret);
      case StateMachineStep.StartExportJob:
        return await startExportJob(event.data, secret);
      case StateMachineStep.GetExportJobStatus:
        return await getExportJobStatus(event.data, secret);
    }
  } catch (e) {
    if (e instanceof AxiosError) {
      // Axios error is too verbose, leave only the key information
      console.log(`Cannot perform request (${e.response?.status}): ${e.message}`);
      console.log(`Response: `, e.response?.data);
      console.log(e.stack);
      throw new Error(`Cannot perform request (${e.response?.status}): ${e.message}`);
    } else {
      throw e;
    }
  }
}

/**
 * Doesn't let the state machine to run simultaneously, to avoid locks and other performance problems.
 */
async function protectAgainstDuplicateRun(data: StateMachineData): Promise<StateMachineData> {
  const stateMachineName = process.env.STATE_MACHINE_NAME;
  if (stateMachineName == null || stateMachineName.length === 0) {
    throw new Error(`STATE_MACHINE_NAME is not defined`);
  }

  const executionsCount = await StepFunctions.getExecutionsCount(stateMachineName);
  if (executionsCount > 1) {
    throw new Error('Detected existing execution, terminating current run');
  }
  return data;
}

/**
 * Fetch last backup job for the service and return its id and status
 */
async function getLastBackupJobStatus(
  data: StateMachineData,
  secrets: OwnBackupDataSecrets,
): Promise<StateMachineData> {
  if (data.isBackupJobComplete && data.backupJobId) {
    return data;
  }

  const apiClient = await getOwnApiClient(secrets);
  const backupsResponse = await apiClient.getBackups(secrets.serviceId);
  // Backups are sorted, last backup is last entry in array
  const lastBackup = backupsResponse[backupsResponse.length - 1];
  const backupJobId = lastBackup.id;

  // This should be the case for the backup job
  const isBackupJobComplete = lastBackup.status !== 'INPROGRESS' && lastBackup.completed_at != null;
  let isBackupJobTimeout = false;

  // If this field is present then this job has been triggered by the CloudWatch event and this is the run start time
  if (data.time) {
    const passedHours = (Date.now() - new Date(data.time).getTime()) / MsInHour;
    isBackupJobTimeout = !isBackupJobComplete && passedHours >= BackupJobTimeoutThresholdHours;
    console.log(`Waiting for the backup job for ${passedHours} hours, timeout: ${isBackupJobTimeout},
      complete: ${isBackupJobComplete}`);
  }

  return {
    ...data,
    isBackupJobComplete,
    isBackupJobTimeout,
    backupJobId,
  };
}

/**
 * Start new export job for the specific backup job and return export job id
 */
async function startExportJob(data: StateMachineData, secrets: OwnBackupDataSecrets): Promise<StateMachineData> {
  if (data.exportJobId) {
    return data;
  }
  if (data.backupJobId == null) {
    throw new Error('Backup job id is not defined');
  }

  const apiClient = await getOwnApiClient(secrets);

  try {
    const exportResponse = await apiClient.exportBackupToEndpoint(
      secrets.serviceId,
      data.backupJobId,
      secrets.endpointId,
    );
    return {
      ...data,
      exportJobId: exportResponse.job_id,
    };
  } catch (e) {
    console.error(`Cannot start OwnBackup export job`, e);
    throw e;
  }
}

/**
 * Get status of the specific export job
 */
async function getExportJobStatus(data: StateMachineData, secrets: OwnBackupDataSecrets): Promise<StateMachineData> {
  if (data.isExportJobComplete && data.exportJobId) {
    return data;
  }
  if (data.exportJobId == null) {
    throw new Error('Export job id is not defined');
  }

  const apiClient = await getOwnApiClient(secrets);
  const jobStatusResponse = await apiClient.getJob(data.exportJobId);

  return {
    ...data,
    isExportJobComplete: jobStatusResponse.progress === 100,
    exportJobId: data.exportJobId,
  };
}

async function getOwnApiClient(secret: OwnBackupDataSecrets): Promise<OwnDataClient> {
  const apiClient = new OwnDataClient(OwnDataRegionalDomain, secret.refreshToken);
  await apiClient.authenticate();

  // LAMBDA-83411: Add a 10-second delay between token generation and API call to make sure the token is propagated across Ownbackup's infrastructure
  await sleep(10000);

  return apiClient;
}

/**
 * Pauses execution for the specified duration in milliseconds
 * @param ms Duration to sleep in milliseconds
 * @returns Promise that resolves after the specified duration
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
