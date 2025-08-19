import { z } from 'zod';
import { SecretsManager } from './secrets-manager';

export enum StateMachineStep {
  ProtectAgainstDuplicateRun = 'ProtectAgainstDuplicateRun',
  GetLastBackupJobStatus = 'GetLastBackupJobStatus',
  StartExportJob = 'StartExportJob',
  GetExportJobStatus = 'GetExportJobStatus',
}

export async function getSecrets(): Promise<OwnBackupDataSecrets> {
  const secretsKey = process.env.SECRETS_KEY as string;
  if (secretsKey === undefined) {
    throw new Error('SECRETS_KEY is missing.');
  }

  const secret = await SecretsManager.fetchJsonSecrets<OwnBackupDataSecretsRaw>(secretsKey);
  if (secret == null) {
    throw new Error(`Cannot fetch secrets from the '${secretsKey}', please ensure correct configuration!`);
  }

  return JSON.parse(secret.OWNBACKUP_DATA);
}

interface OwnBackupDataSecretsRaw {
  OWNBACKUP_DATA: string;
}

export interface OwnBackupDataSecrets {
  endpointId: string;
  serviceId: number;
  refreshToken: string;
}

export const StateMachineDataType = z
  .object({
    isBackupJobComplete: z.boolean().optional(),
    backupJobId: z.number().optional(),
    isExportJobComplete: z.boolean().optional(),
    exportJobId: z.number().optional(),
    time: z.string().optional(),
    isBackupJobTimeout: z.boolean().optional(),
  })
  .passthrough();

export type StateMachineData = z.infer<typeof StateMachineDataType>;

export const ExporterLambdaEventType = z.object({
  data: StateMachineDataType,
  step: z.nativeEnum(StateMachineStep),
});

export type ExporterLambdaEvent = z.infer<typeof ExporterLambdaEventType>;
