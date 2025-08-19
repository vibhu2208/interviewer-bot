import { ApiResponse, Client } from '@opensearch-project/opensearch';
import { RequestBody } from '@opensearch-project/opensearch/lib/Transport';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { STS } from 'aws-sdk';
import { logger } from '../../logger';
import { XoHiringSfAPISSMConfig } from '../../ssm-config';

export const sts = new STS({ region: process.env.AWS_REGION ?? 'us-east-1' });
// TODO: Externalize this configuration
const CandidatesAliasName = 'all_candidates';

let defaultClient: OpenSearchClient;

export class OpenSearchClient {
  private readonly client: Client;

  constructor(private readonly config: XoHiringSfAPISSMConfig) {
    this.client = new Client({
      ...AwsSigv4Signer({
        region: process.env.AWS_REGION ?? 'us-east-1',
        service: config.opensearch.serviceName,
        getCredentials: async () => {
          try {
            const response = await sts
              .assumeRole({
                RoleArn: config.opensearch.role,
                RoleSessionName: `xo-hiring-sf-api-${process.env.AWS_LAMBDA_FUNCTION_NAME}`.slice(0, 64),
              })
              .promise();
            if (response.Credentials) {
              return {
                secretAccessKey: response.Credentials.SecretAccessKey,
                accessKeyId: response.Credentials.AccessKeyId,
                sessionToken: response.Credentials.SessionToken,
              };
            }
          } catch (e) {
            logger.error('Cannot assume IAM role to access opensearch', e as Error);
          }

          logger.info('Accessing opensearch through a default credentials provider');
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: config.opensearch.endpoint,
    });
  }

  public async search(aliasName: string, query: RequestBody): Promise<ApiResponse> {
    return this.client.search({
      index: aliasName,
      body: query,
    });
  }

  public async getDocument(aliasName: string, id: string): Promise<ApiResponse> {
    return this.client.get({
      index: aliasName,
      id: id,
    });
  }

  public async getCandidate(candidateId: string): Promise<ApiResponse> {
    return this.getDocument(CandidatesAliasName, candidateId);
  }

  public static default(config: XoHiringSfAPISSMConfig): OpenSearchClient {
    if (defaultClient) {
      return defaultClient;
    }
    defaultClient = new OpenSearchClient(config);
    return defaultClient;
  }
}
