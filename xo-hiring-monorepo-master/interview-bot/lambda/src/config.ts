import { LlmDefinition } from '@trilogy-group/xoh-integration';

export const DefaultRegion = 'us-east-1';
export const DefaultEnvironment = 'sandbox';
export const DefaultFrontendUrl = 'https://sandbox-assessments.crossover.com';
export const SsmParameterChatGptApiKey = '/xo-hiring-admin/production/chatgpt/api-key';
export const ProjectName = 'xo-hiring';
export const LLMProjectName = 'interviewBot';

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

  static getGptQueueUrl(): string {
    return requireEnvVariable('GPT_QUEUE_URL');
  }

  static getStatusEventQueueUrl(): string {
    return requireEnvVariable('STATUS_EVENT_QUEUE_URL');
  }

  static getAppSyncEndpointUrl(): string {
    return requireEnvVariable('APPSYNC_ENDPOINT_URL');
  }

  static getSnsTopic(): string {
    return requireEnvVariable('SNS_TOPIC_ARN');
  }

  static getAthenaDatabaseName(): string {
    return requireEnvVariable('ATHENA_DATABASE_NAME');
  }

  static getFrontendUrl(): string {
    return process.env.FRONTEND_URL ?? DefaultFrontendUrl;
  }

  static getGptMessagesNumRetries(): number {
    return 3;
  }

  static getDelayedStatusEventSMArn(): string {
    return requireEnvVariable('DELAYED_STATUS_EVENT_SM_ARN');
  }

  /**
   * Returns the default session duration in minutes
   */
  static getDefaultSessionDuration(): number {
    return 180;
  }

  static getDefaultSessionTimeboxed(): boolean {
    return true;
  }

  /**
   * Sessions that are not timeboxed will have their expiration time = duration * this
   */
  static getNonTimeboxedSessionDurationMultiplier(): number {
    return 3;
  }

  static getMatchingInterviewLlmModel(): LlmDefinition {
    return {
      model: 'arn:aws:bedrock:us-east-1:104042860393:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0',
      provider: 'bedrock',
      projectName: LLMProjectName,
    };
  }

  /**
   * Skill IDs that are part of the matching interview A/B test pilot
   * These skills are eligible for the matching interview variant
   */
  static getMatchingInterviewPilotSkillIds(): Set<string> {
    return new Set([
      '21600000-0000-0000-0000-000000000000', // AI-First Lead Product Owner
    ]);
  }
}

function requireEnvVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Required environmental variable is not defined: ${name}`);
  }
  return value;
}
