import { z } from 'zod';

export const ProcessEnvType = z.object({
  SECRETS_KEY: z.string(),
  AWS_REGION: z.string(),
  INVOKE_HANDLER: z.unknown().optional(),
});

export type ProcessEnvConfig = z.infer<typeof ProcessEnvType>;

export const EnvConfigType = z.object({
  athenaDb: z.string(),
  athenaOutputLocation: z.string(),
  kontentProjectId: z.string(),
  managementApiKey: z.string(),
});

export type EnvConfig = z.infer<typeof EnvConfigType>;
