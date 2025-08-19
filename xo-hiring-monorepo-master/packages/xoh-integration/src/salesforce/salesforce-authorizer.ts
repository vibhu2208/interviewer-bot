import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getStableEnvironmentName } from '../environment';
import { Ssm } from '../ssm';
import { SalesforceIntegrationLogger } from './logging';
import { SalesforceEnvironment } from './salesforce';

export class SalesforceAuthorizer {
  static readonly AuthUrl = '/services/oauth2/token';
  static readonly SharedAccessTokenSSMKey = (env: string) => `/xo-hiring/${env}/salesforceAuthorizer/access_token`;
  static readonly SharedAccessTokenInvalidPlaceholder = 'invalid';

  static async getSharedAccessTokens(env = getStableEnvironmentName()): Promise<Token[]> {
    return (await Ssm.fetchParameterJson(SalesforceAuthorizer.SharedAccessTokenSSMKey(env))) ?? [];
  }

  static async setSharedAccessTokens(tokens: Token[], env = getStableEnvironmentName()): Promise<void> {
    await Ssm.setParameter(SalesforceAuthorizer.SharedAccessTokenSSMKey(env), JSON.stringify(tokens, null, 2));
  }

  /**
   * Generate a new Salesforce access token. Can be replaced with some other function later
   * @param env
   */
  static async generateSalesforceToken(env: SalesforceEnvironment): Promise<string> {
    const client = axios.create({ baseURL: env.baseUrl });
    const authResult = await client.postForm(SalesforceAuthorizer.AuthUrl, {
      grant_type: 'password',
      ...env.credentials,
    });
    return authResult.data.access_token;
  }

  constructor(private env: SalesforceEnvironment) {}

  private cachedAccessToken?: string;

  /**
   * Configure interceptors for Axios instance in order to authorize any future call to Salesforce
   * @param axiosInstance
   */
  setup(axiosInstance: AxiosInstance) {
    axiosInstance.interceptors.request.use(async (requestConfig) =>
      this.configureRequest(requestConfig, await this.getToken()),
    );

    axiosInstance.interceptors.response.use(undefined, async (error) => {
      // Handle 401 Unauthorized errors by refreshing the access token
      await this.handleAuthFailure(error);
    });
  }

  private configureRequest(
    requestConfig: InternalAxiosRequestConfig<unknown>,
    accessToken: string,
  ): InternalAxiosRequestConfig<unknown> {
    // Set the authorization header for every request
    requestConfig.headers.set('Authorization', `Bearer ${accessToken}`);

    return requestConfig;
  }

  private async getToken(invalidateLocalCache?: boolean): Promise<string> {
    // local cache
    if (!invalidateLocalCache && this.cachedAccessToken) {
      return this.cachedAccessToken;
    }

    // shared cache
    const allTokens = await SalesforceAuthorizer.getSharedAccessTokens();

    const sharedAccessToken =
      getToken(allTokens, this.env.credentials.username) ?? SalesforceAuthorizer.SharedAccessTokenInvalidPlaceholder;

    if (
      sharedAccessToken != SalesforceAuthorizer.SharedAccessTokenInvalidPlaceholder &&
      sharedAccessToken != this.cachedAccessToken
    ) {
      // init local cache
      this.cachedAccessToken = sharedAccessToken;
      SalesforceIntegrationLogger.info('Using a shared access_token');
      return sharedAccessToken;
    }

    // issue new access_token in Salesforce
    SalesforceIntegrationLogger.info(`Authorizing in ${this.env.baseUrl} as ${this.env.credentials.username}`);
    const newAccessToken = await SalesforceAuthorizer.generateSalesforceToken(this.env);

    setToken(allTokens, this.env.credentials.username, newAccessToken);

    // init shared cache
    await SalesforceAuthorizer.setSharedAccessTokens(allTokens);

    // init local cache
    this.cachedAccessToken = newAccessToken;

    return newAccessToken;
  }

  private async handleAuthFailure(error: unknown) {
    if (!axios.isAxiosError(error)) {
      throw error;
    }

    if (error.response?.status === 401 && error.config != null) {
      SalesforceIntegrationLogger.info('Unauthorized (401), fetching the new token');
      return axios.request(this.configureRequest(error.config, await this.getToken(true)));
    }
    throw error;
  }
}

interface Token {
  user: string;
  token: string;
}

// Retrieve a token for a given user from the token map
function getToken(allTokens: Token[], user: string): string | undefined {
  return allTokens.find((t) => t.user == user)?.token;
}

// Set a token for a given user in the token map
function setToken(allTokens: Token[], user: string, token: string): Token[] {
  const ix = allTokens.findIndex((t) => t.user == user);
  if (ix >= 0) {
    allTokens[ix].token = token;
  } else {
    allTokens.push({
      user: user,
      token: token,
    });
  }
  return allTokens;
}
