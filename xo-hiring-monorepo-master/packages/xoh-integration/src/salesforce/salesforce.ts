import { getStableEnvironmentName } from '../environment';
import { Ssm } from '../ssm';
import { IntegrationLogger, SalesforceIntegrationLogger } from './logging';
import { SalesforceClient } from './salesforce-client';

const DefaultClientName = 'default';
const AdminClientName = 'admin';
const SalesforceClients: Map<string, SalesforceClient> = new Map<string, SalesforceClient>();

export class Salesforce {
  /**
   * Get no-reply+app account environment (Frontend API profile)
   * @param env
   */
  static async getEnvironment(env = getStableEnvironmentName()): Promise<SalesforceEnvironment | null> {
    return await Ssm.fetchParameterJson(`/xo-hiring/${env}/common/salesforce-app-account`);
  }

  /**
   * Get no-reply+recruiting account credentials (admin profile)
   * @param env
   */
  static async getAdminCredentials(
    env = getStableEnvironmentName(),
  ): Promise<SalesforceUsernamePasswordCredentials | null> {
    const serviceAccountConfig = await Ssm.fetchParameterJson<{
      clientId: string;
      clientSecret: string;
      username: string;
      password: string;
      securityToken: string;
    }>(`/xo-hiring/${env}/common/salesforce-service-account`);
    if (serviceAccountConfig == null) {
      return null;
    }
    return {
      client_id: serviceAccountConfig.clientId,
      client_secret: serviceAccountConfig.clientSecret,
      username: serviceAccountConfig.username,
      password: serviceAccountConfig.password + serviceAccountConfig.securityToken,
    };
  }

  /**
   * Just a shortcut to set the log level to error, to prevent the flood of the integration logs.
   * Useful for local development or scripts that actually produce meaningful console output.
   */
  static silent(): void {
    SalesforceIntegrationLogger.setLogLevel('ERROR');
  }

  /**
   * Get the default client, or create a new one if it doesn't exist
   */
  static async getDefaultClient(): Promise<SalesforceClient> {
    const salesforceClient = SalesforceClients.get(DefaultClientName);
    return salesforceClient ?? (await Salesforce.createClient());
  }

  /**
   * Get admin client (that uses system admin profile)
   */
  static async getAdminClient(): Promise<SalesforceClient> {
    const adminCredentials = await Salesforce.getAdminCredentials();
    if (adminCredentials == null) {
      throw new Error('No Salesforce admin credentials found');
    }
    const salesforceClient = SalesforceClients.get(AdminClientName);
    return (
      salesforceClient ??
      (await Salesforce.createClient({
        name: AdminClientName,
        credentials: adminCredentials,
      }))
    );
  }

  /**
   * Create a new client and cache it
   * @param config Optional configuration
   */
  static async createClient(config?: SalesforceClientConfig): Promise<SalesforceClient> {
    const envConfig = await Salesforce.getEnvironment(config?.env);
    if (!envConfig) {
      throw new Error('No Salesforce environment found');
    }

    if (config?.credentials != null) {
      envConfig.credentials = {
        ...envConfig.credentials,
        ...config.credentials,
      };
    }

    const integrationLogger = new IntegrationLogger();
    const client = new SalesforceClient(envConfig, integrationLogger);

    SalesforceClients.set(config?.name ?? DefaultClientName, client);

    return client;
  }
}

export interface SalesforceClientConfig {
  /**
   * Env name override
   */
  env?: string;
  /**
   * Set specific client name if you want to cache multiple clients
   */
  name?: string;
  /**
   * Override the default credentials
   */
  credentials?: Partial<SalesforceUsernamePasswordCredentials>;
}

export interface SalesforceEnvironment {
  name: string;
  baseUrl: string;
  documentUrl: string;
  credentials: SalesforceUsernamePasswordCredentials;
}

export interface SalesforceUsernamePasswordCredentials {
  client_id: string;
  client_secret: string;
  username: string;
  /**
   * For the username+password oauth flow, the password is the concatenation of the user's password and the user's security token.
   */
  password: string;
}
