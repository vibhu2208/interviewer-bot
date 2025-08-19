// Note: this file is created because neither nforce nor jsforce can call custom apex invocables
import axios, { AxiosInstance, AxiosResponse, Method } from 'axios';
import { getNamedSalesforceClientWithCustomCredentials } from '@trilogy-group/xo-hiring-integration';

export interface SfConfig {
  clientName: string;
  authServer: string;
  apiServer: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

interface ErrorResponse {
  errorCode: string;
  message: string;
}

export class SFLite {
  #config: SfConfig;
  #client: AxiosInstance | null = null;

  constructor(newConfig: SfConfig) {
    this.#config = newConfig;
  }

  async request(
    url: string,
    method: Method,
    data?: null | string | { inputs: object[] },
    headers?: { [key: string]: string },
  ): Promise<AxiosResponse<unknown>> {
    // Instantiate client
    if (!this.#client) {
      this.#client = await getNamedSalesforceClientWithCustomCredentials(this.#config.clientName, {
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        username: this.#config.username,
        password: this.#config.password,
      });
    }

    // Do the action
    const response = await this.#client.request({
      method,
      url: this.#config.apiServer + url,
      data,
      headers: {
        ...headers,
      },
    });

    // Success
    if (SFLite.isResponseSuccessful(response.status)) {
      // Note: already parsed
      return response;
    }

    const { message } = SFLite.decodeError(response.data);

    throw new Error(`POST ${url} has responded with HTTP ${response.status} ${message}`);
  }

  get(url: string) {
    return this.request(url, 'get');
  }

  post(url: string, data: string | { inputs: object[] }) {
    return this.request(url, 'post', data, { 'Content-Type': 'application/json' });
  }

  runApex(apex: string) {
    return this.get('/services/data/v49.0/tooling/executeAnonymous/?anonymousBody=' + encodeURIComponent(apex));
  }

  static decodeError(body: ErrorResponse | string | unknown) {
    if (Array.isArray(body) && body.length > 0) {
      return { message: `${body[0].errorCode} - ${body[0].message}`, errorCode: body[0].errorCode };
    }
    if (typeof body === 'string') {
      return { message: body, errorCode: body };
    }
    return { message: 'Unrecognized error', errorCode: null };
  }

  static isResponseSuccessful(status: number) {
    const STATUS_200 = 200;
    const STATUS_300 = 300;
    return status >= STATUS_200 && status < STATUS_300;
  }
}

export async function callbackGT(
  url: string,
  method: Method,
  data?: null | string | { inputs: object[] },
  headers?: { [key: string]: string },
  maxRetries = 1,
): Promise<AxiosResponse<unknown>> {
  // Do the action
  const response = await axios.request({
    method,
    url: url,
    data,
    headers: headers,
  });

  if (SFLite.isResponseSuccessful(response.status)) {
    return response;
  }

  const { message } = SFLite.decodeError(response.data);
  if (maxRetries > 0) {
    // Retry
    return await callbackGT(url, method, data, headers, maxRetries - 1);
  }

  // Unrecoverable
  throw new Error(`POST ${url} has responded with HTTP ${response.status} ${message}`);
}
