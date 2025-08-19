import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient();

export class SecretsManager {
  static async fetchSecret(secretName: string): Promise<string | null> {
    const secret = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
    return secret.SecretString ?? null;
  }

  static async fetchSecretJson<T>(secretName: string): Promise<T | null> {
    const secretString = await SecretsManager.fetchSecret(secretName);
    return secretString != null ? JSON.parse(secretString) : null;
  }
}
