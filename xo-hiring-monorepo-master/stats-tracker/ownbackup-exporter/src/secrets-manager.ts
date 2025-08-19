import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

export class SecretsManager {
  static async fetchSecret(secretName: string): Promise<string | undefined> {
    const secret = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
    return secret.SecretString;
  }

  static async fetchJsonSecrets<T>(secretName: string): Promise<T | null> {
    const secretString = await SecretsManager.fetchSecret(secretName);
    return secretString ? JSON.parse(secretString) : null;
  }
}
