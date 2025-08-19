// @ts-nocheck
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node'; // V3 SDK.
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';

export function createOpenSearchClient(serviceName: string, endpoint: string) {
  return new Client({
    ...AwsSigv4Signer({
      region: process.env.AWS_REGION,
      service: serviceName,
      // Example with AWS SDK V3:
      getCredentials: () => {
        // Any other method to acquire a new Credentials object can be used.
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: endpoint,
  });
}
