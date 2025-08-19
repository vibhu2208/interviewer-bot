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

  static getDataBucketName(): string {
    return requireEnvVariable('DATA_BUCKET');
  }

  static getAthenaTable(): string {
    return requireEnvVariable('ATHENA_TABLE');
  }

  static getAthenaDb(): string {
    return requireEnvVariable('ATHENA_DB');
  }

  static getIntegrationUserSecretName(): string {
    return requireEnvVariable('INTEGRATION_USER_SECRET');
  }

  static getMailosaurSecret(): string {
    return requireEnvVariable('MAILOSAUR_SECRET');
  }

  static getEmailIdentity(): string {
    return requireEnvVariable('EMAIL_IDENTITY');
  }

  static getEmailConfigurationSet(): string {
    return requireEnvVariable('EMAIL_CONFIGURATION_SET');
  }

  static shouldMockEmails(): boolean {
    return process.env.MOCK_EMAILS != null && process.env.MOCK_EMAILS !== 'false';
  }
}

function requireEnvVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Required environmental variable is not defined: ${name}`);
  }
  return value;
}
