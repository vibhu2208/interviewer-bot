import { DeliveryClient } from '@kontent-ai/delivery-sdk';
import { SecretsManager } from '@trilogy-group/xoh-integration';

let client: DeliveryClient;

export class Kontent {
  static async deliveryClient(): Promise<DeliveryClient> {
    if (client != null) {
      return client;
    }

    if (!process.env.KONTENT_SECRET_NAME) {
      throw new Error('KONTENT_SECRET_NAME env variable should be defined');
    }
    const kontentSecret = await SecretsManager.fetchSecretJson<KontentSecret>(process.env.KONTENT_SECRET_NAME);
    if (kontentSecret == null) {
      throw new Error(`Kontent secret is not available`);
    }

    client = new DeliveryClient({ environmentId: kontentSecret.project_id });

    return client;
  }
}

interface KontentSecret {
  project_id: string;
  management_api_key: string;
}
