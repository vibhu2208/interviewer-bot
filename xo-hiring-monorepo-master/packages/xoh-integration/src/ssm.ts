import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient();

export class Ssm {
  static async fetchParameter(name: string): Promise<string | null> {
    const response = await ssmClient.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    return response?.Parameter?.Value ?? null;
  }

  static async fetchParameterJson<T>(name: string): Promise<T | null> {
    const value = await Ssm.fetchParameter(name);
    return value != null ? (JSON.parse(value) as T) : null;
  }

  static async setParameter(name: string, value: string): Promise<void> {
    await ssmClient.send(new PutParameterCommand({ Name: name, Value: value, Type: 'String', Overwrite: true }));
  }
}
