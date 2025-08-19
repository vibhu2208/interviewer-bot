import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

export class Secrets {
  static async fetchJsonSecret<T>(secretId: string): Promise<T> {
    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: secretId,
      }),
    );
    if (response.SecretString == null) {
      throw new Error(`Cannot fetch a value of secret ${secretId}`);
    }
    return JSON.parse(response.SecretString);
  }
}
