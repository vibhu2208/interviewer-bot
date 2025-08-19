import { DeliveryClient } from '@kontent-ai/delivery-sdk';
import { Secrets } from './secrets';

let client: DeliveryClient;

export class Kontent {
  static async deliveryClient(): Promise<DeliveryClient> {
    if (client) {
      return client;
    }

    if (!process.env.KONTENT_SECRET_NAME) {
      throw new Error('KONTENT_SECRET_NAME env variable should be defined');
    }

    const kontentAuth: KontentSecret = await Secrets.fetchJsonSecret(process.env.KONTENT_SECRET_NAME);

    client = new DeliveryClient({ environmentId: kontentAuth.project_id });

    return client;
  }
}

interface KontentSecret {
  project_id: string;
  management_api_key: string;
}
