import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import JiraApi from 'jira-client';

export class Jira {
  private static client: JiraApi;

  public static async findExistingBfqVerificationTicket(id: string): Promise<string | null> {
    const client = await Jira.getClient();
    const response = await client.searchJira(`issuetype = "BFQ Verification" AND  cf[10698] ~ "${id}"`);
    return response.issues?.[0]?.key ?? null;
  }

  public static async createBfqVerificationTicket(id: string, pipelineCode: number): Promise<string> {
    const client = await Jira.getClient();
    const issueData = {
      fields: {
        project: { key: 'NTO' },
        issuetype: { name: 'BFQ Verification' },
        summary: `BFQ Verification ticket for application: ${id} - ${pipelineCode}`,
        description: `https://crossover.lightning.force.com/lightning/r/Opportunity/${id}/view`,
        customfield_10698: id, // JIRA_FIELD_PIPELINE_MANAGER
        customfield_10100: -5.0, // JIRA_FIELD_ALP_PRIORITY
        labels: ['autoupdated'],
      },
    };
    console.log(`Creating a new Jira Issue`, issueData);
    if (!Jira.isDryRun()) {
      const response = await client.addNewIssue(issueData);
      return response.key as string;
    } else {
      return 'DRYRUN-1';
    }
  }

  public static isDryRun(): boolean {
    return process.env.JIRA_DRY_RUN === 'true';
  }

  public static async getClient() {
    if (Jira.client != null) {
      return Jira.client;
    }

    const config = await Jira.fetchJiraConfig();
    Jira.client = new JiraApi({
      protocol: 'https',
      host: config.host,
      username: config.username,
      password: config.token,
      apiVersion: '2',
      strictSSL: true,
    });

    return Jira.client;
  }

  private static async fetchJiraConfig(): Promise<JiraConfiguration> {
    if (!process.env.JIRA_USER_SECRET_NAME) {
      throw new Error('JIRA_USER_SECRET_NAME env variable should be defined');
    }
    // This lambda will run rarely, no need to cache AWS client in the global scope
    const secretsManagerClient = new SecretsManagerClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });
    const response = await secretsManagerClient.send(
      new GetSecretValueCommand({
        SecretId: process.env.JIRA_USER_SECRET_NAME,
      }),
    );
    if (response.SecretString == null) {
      throw new Error('Cannot fetch jira data from the secrets');
    }
    return JSON.parse(response.SecretString);
  }
}

interface JiraConfiguration {
  username: string;
  token: string;
  host: string;
}
