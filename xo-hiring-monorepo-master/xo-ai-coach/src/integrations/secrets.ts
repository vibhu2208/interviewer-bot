import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Config } from '../config';

const client = new SecretsManagerClient({ region: Config.getRegion() });

export class Secrets {
  static async fetchJsonSecret<T>(secretId: string): Promise<T> {
    const response = await client.send(
      // @ts-ignore For some reason there is a typing error here
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
