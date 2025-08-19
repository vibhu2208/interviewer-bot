import { getSalesforceClient, IntegrationLogger } from '@trilogy-group/xo-hiring-integration';
import axios, { AxiosInstance } from 'axios';
import CryptoJs from 'crypto-js';
import { SalesforceRest } from '../../urls';

/**
 * Configuration cached in global scope to be shared across lambda invocations
 */
let veriffConfiguration: VeriffConfiguration;

/**
 * Cached Veriff client
 */
let defaultClient: VeriffClient;

/**
 * Fetch Veriff configuration from the Salesforce (Vendor Configuration Metadata)
 * Or returned cached config
 */
async function getVeriffConfiguration(): Promise<VeriffConfiguration> {
  if (veriffConfiguration != null) {
    return veriffConfiguration;
  }

  // Query salesforce to get vendor metadata
  const client = await getSalesforceClient();
  const response = await client.get(SalesforceRest.query, {
    params: {
      q: `SELECT Base_URL__c, Private_key__c, Public_Key__c 
            FROM X3rd_Party_System_Configuration__mdt WHERE DeveloperName = 'Veriff' LIMIT 1`,
    },
  });

  const record = response.data?.records?.[0];
  if (record == null) {
    throw new Error('Cannot query Veriff configuration, empty response');
  }

  veriffConfiguration = {
    baseUrl: record.Base_URL__c,
    privateKey: record.Private_key__c,
    publicKey: record.Public_Key__c,
  };
  return veriffConfiguration;
}

export class VeriffClient {
  private readonly client: AxiosInstance;

  private constructor(private config: VeriffConfiguration) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'X-AUTH-CLIENT': config.publicKey,
      },
    });
    // Setup the same logging we have for other requests
    new IntegrationLogger().setup(this.client);
  }

  public async listMedia(sessionId: string): Promise<VeriffMediaResponse> {
    const signature = CryptoJs.HmacSHA256(sessionId, this.config.privateKey).toString(CryptoJs.enc.Hex);

    const response = await this.client.get(`/v1/sessions/${sessionId}/media`, {
      headers: {
        'X-HMAC-SIGNATURE': signature,
      },
    });

    return response.data;
  }

  public async getMediaContent(mediaId: string): Promise<any> {
    const signature = CryptoJs.HmacSHA256(mediaId, this.config.privateKey).toString(CryptoJs.enc.Hex);

    // We use non-instrumented client because we don't want to log response content
    const response = await axios.get(`/v1/media/${mediaId}`, {
      responseType: 'arraybuffer',
      baseURL: this.config.baseUrl,
      headers: {
        'X-AUTH-CLIENT': this.config.publicKey,
        'X-HMAC-SIGNATURE': signature,
      },
    });

    return response.data;
  }

  public static async default(): Promise<VeriffClient> {
    if (defaultClient) {
      return defaultClient;
    }
    defaultClient = new VeriffClient(await getVeriffConfiguration());
    return defaultClient;
  }
}

export interface VeriffConfiguration {
  baseUrl: string;
  privateKey: string;
  publicKey: string;
}

export interface VeriffEventPayload {
  status: string;
  verification: {
    id: string;
    status: string;
    vendorData: string;
  };
}

export interface VeriffMediaResponse {
  status: string;
  images: VeriffMediaElement[];
  videos: VeriffMediaElement[];
}

export interface VeriffMediaElement {
  id: string;
  name: string;
  context: string;
  size: number;
  mimetype: string;
  sessionId: string;
  url: string;
}
