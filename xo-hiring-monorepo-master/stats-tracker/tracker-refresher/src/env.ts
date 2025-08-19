import { z } from 'zod';

export const ProcessEnvType = z.object({
  SECRETS_KEY: z.string(),
  AWS_REGION: z.string(),
  // invokes lambda handler on module load, useful for running locally
  INVOKE_HANDLER: z.unknown().optional(),

  // target tracker spreadsheet
  TARGET_TITLE_PREFIX: z.string().optional().default(''),
  TARGET_SPREADSHEET_ID: z.string().optional(),
  TARGET_SHEET_ID: z.string().transform(Number).optional().default('0'),
});

export type ProcessEnvConfig = z.infer<typeof ProcessEnvType>;

export const EnvConfigType = z.object({
  athenaDb: z.string(),
  athenaOutputLocation: z.string(),

  // specify this to reuse existing query results
  athenaExecutionId: z.string().optional(),

  // credentials with access to target spreadsheet
  googleAuthClientEmail: z.string(),
  googleAuthPrivateKey: z.string(),
  // template spreadsheet
  templateSpreadsheetId: z.string(),
  templateSheetId: z.string().transform(Number),
  templateSheetRange: z.string().default('A1:AW4'),
});

export type EnvConfig = z.infer<typeof EnvConfigType>;
