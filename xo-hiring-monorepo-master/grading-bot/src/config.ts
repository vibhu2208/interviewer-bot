export const DefaultRegion = 'us-east-1';
export const DefaultEnvironment = 'sandbox';
export const ProjectName = 'xo-hiring';

export class Config {
  static getRegion(): string {
    return process.env.AWS_REGION ?? DefaultRegion;
  }

  static getEnv(): string {
    return process.env.ENV ?? DefaultEnvironment;
  }

  static getMainDdbTableName(): string {
    return requireEnvVariable('DDB_TABLE_MAIN');
  }

  static getTasksQueueUrl(): string {
    return requireEnvVariable('TASKS_QUEUE_URL');
  }

  static getAthenaOutputLocation(): string {
    return requireEnvVariable('ATHENA_OUTPUT_LOCATION');
  }

  static getAthenaDb(): string {
    return requireEnvVariable('ATHENA_DB');
  }

  static getGoogleCredentialsSecretName(): string {
    return requireEnvVariable('GOOGLE_CREDENTIALS_SECRET_NAME');
  }

  static getBatchReportsBucketName(): string {
    return requireEnvVariable('BATCH_REPORTS_BUCKET');
  }

  static getOpenAiSecretName(): string {
    return requireEnvVariable('OPENAI_SECRET_NAME');
  }

  static getDelayQueueEventSmArn(): string {
    return requireEnvVariable('DELAY_QUEUE_EVENTS_SM_ARN');
  }

  static getNumRetires(): number {
    return 3;
  }

  static getDefaultModel(): string {
    return 'gpt-4';
  }
}

function requireEnvVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Required environmental variable is not defined: ${name}`);
  }
  return value;
}
