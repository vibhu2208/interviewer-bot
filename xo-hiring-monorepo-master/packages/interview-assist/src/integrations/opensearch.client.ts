import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsCredentialIdentity } from '@aws-sdk/types';
import { ApiResponse, Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer, AwsSigv4SignerOptions } from '@opensearch-project/opensearch/aws';
import { RequestBody } from '@opensearch-project/opensearch/lib/Transport';
import { defaultLogger } from '@trilogy-group/xoh-integration';
import { XoHiringSfAPISSMConfig } from '../config/ssm.config';

const logger = defaultLogger({ serviceName: 'interview-assist-opensearch-client' });

const DEFAULT_CANDIDATES_ALIAS_NAME = 'all_candidates';

let clientInstance: OpenSearchClient;

/**
 * OpenSearch client for Interview Assist
 */
export class OpenSearchClient {
  private readonly client: Client;

  constructor(private readonly config: XoHiringSfAPISSMConfig) {
    logger.info(`Initializing OpenSearchClient with endpoint: ${config.opensearch.endpoint}`);

    const getCredentials = async (): Promise<AwsCredentialIdentity> => {
      const stsClient = new STSClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
      try {
        const assumeRoleCommand = new AssumeRoleCommand({
          RoleArn: config.opensearch.role,
          RoleSessionName: `xo-hiring-sf-api-${process.env.AWS_LAMBDA_FUNCTION_NAME || 'interview-assist'}`.slice(
            0,
            64,
          ),
        });
        const response = await stsClient.send(assumeRoleCommand);

        if (
          response.Credentials &&
          response.Credentials.AccessKeyId &&
          response.Credentials.SecretAccessKey &&
          response.Credentials.SessionToken
        ) {
          logger.info('Successfully assumed IAM role for OpenSearch access (v3 STS).');
          return {
            secretAccessKey: response.Credentials.SecretAccessKey,
            accessKeyId: response.Credentials.AccessKeyId,
            sessionToken: response.Credentials.SessionToken,
          };
        }
        throw new Error('AssumeRole (v3 STS) did not return complete credentials.');
      } catch (e) {
        logger.error(
          'Cannot assume IAM role (v3 STS) or credentials incomplete, falling back to default provider.',
          e as Error,
        );
        const credentialsProvider = defaultProvider();
        const creds = await credentialsProvider();
        if (!creds.accessKeyId || !creds.secretAccessKey) {
          throw new Error('Default credential provider also failed to return complete credentials.');
        }
        return creds;
      }
    };

    this.client = new Client({
      ...AwsSigv4Signer({
        region: process.env.AWS_REGION ?? 'us-east-1',
        service: config.opensearch.serviceName as AwsSigv4SignerOptions['service'],
        getCredentials,
      }),
      node: config.opensearch.endpoint,
    });
  }

  public async search(aliasName: string, query: RequestBody): Promise<ApiResponse> {
    logger.debug(`Searching OpenSearch alias '${aliasName}'`);
    return this.client.search({
      index: aliasName,
      body: query,
    });
  }

  public async getDocument(aliasName: string, id: string): Promise<ApiResponse> {
    logger.debug(`Getting document with ID '${id}' from alias '${aliasName}'.`);
    return this.client.get({
      index: aliasName,
      id: id,
    });
  }

  public async getCandidate(candidateId: string): Promise<ApiResponse> {
    logger.info(`Fetching candidate document with ID: ${candidateId} from alias: ${DEFAULT_CANDIDATES_ALIAS_NAME}`);
    return this.getDocument(DEFAULT_CANDIDATES_ALIAS_NAME, candidateId);
  }

  public static getInstance(config: XoHiringSfAPISSMConfig): OpenSearchClient {
    if (!clientInstance) {
      logger.info('Creating new OpenSearchClient instance (Interview Assist v3 STS).');
      clientInstance = new OpenSearchClient(config);
    } else {
      logger.info('Reusing existing OpenSearchClient instance (Interview Assist v3 STS).');
    }
    return clientInstance;
  }
}
