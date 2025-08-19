import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, Method } from 'axios';
import { IntegrationLogger } from './logging';
import { SalesforceEnvironment } from './salesforce';
import { SalesforceAuthorizer } from './salesforce-authorizer';

export class SalesforceClient {
  public static ApiVersion = 'v60.0';

  private readonly apiClient: AxiosInstance;
  private readonly documentApiClient: AxiosInstance;

  constructor(private salesforceEnv: SalesforceEnvironment, private logger: IntegrationLogger) {
    const authorizer = new SalesforceAuthorizer(this.salesforceEnv);

    // Create normal api client
    this.apiClient = axios.create({ baseURL: this.salesforceEnv.baseUrl });
    authorizer.setup(this.apiClient);
    this.logger.setup(this.apiClient);

    // Client document api client
    this.documentApiClient = axios.create({ baseURL: this.salesforceEnv.documentUrl });
    authorizer.setup(this.documentApiClient);
    this.logger.setup(this.documentApiClient);
  }

  /**
   * Axios instance configured to perform Salesforce REST API calls
   */
  public restApi(): AxiosInstance {
    return this.apiClient;
  }

  /**
   * Axios instance configured to perform Salesforce Document API calls
   */
  public documentApi(): AxiosInstance {
    return this.documentApiClient;
  }

  /**
   * Create an object in Salesforce
   * @param objectType Object type name, i.e. 'Opportunity'
   * @param data Object fields, i.e. { Name: 'New Opportunity', StageName: 'BFQ' }
   * @param config optional additional configuration
   */
  public async createObject<T>(
    objectType: string,
    data: Partial<T>,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    return await this.restApi().post(
      `/services/data/${SalesforceClient.ApiVersion}/sobjects/${objectType}`,
      data,
      config,
    );
  }

  /**
   * Update an object in Salesforce
   * @param objectType Object type name, i.e. 'Opportunity'
   * @param objectId Object id, i.e. '006F300000cPeDeIAK'
   * @param data Object fields to update, i.e. { StageName: 'Rejected' }
   * @param config optional additional configuration
   */
  public async updateObject<T>(
    objectType: string,
    objectId: string,
    data: Partial<T>,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    return await this.restApi().patch(
      `/services/data/${SalesforceClient.ApiVersion}/sobjects/${objectType}/${objectId}`,
      data,
      config,
    );
  }

  /**
   * Delete an object in Salesforce
   * @param objectType Object type name, i.e. 'Opportunity'
   * @param objectId Object id, i.e. '006F300000cPeDeIAK'
   * @param config optional additional configuration
   */
  public async deleteObject(objectType: string, objectId: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return await this.restApi().delete(
      `/services/data/${SalesforceClient.ApiVersion}/sobjects/${objectType}/${objectId}`,
      config,
    );
  }

  /**
   * Update multiple objects in Salesforce using sObject Collections
   * @param data Array of objects to update with type and id required , i.e. [{ id: '006F300000cPeDeIAK', attributes: { type: 'Campaign' } }]
   * @param allOrNone Optional parameter to specify if update can be partial or should fail for all records on any issue
   * @param config optional additional configuration
   */
  public async bulkUpdateObjects(
    data: SalesforceBulkUpdateEntity[],
    allOrNone = false,
    config?: AxiosRequestConfig,
  ): Promise<SalesforceBulkUpdateOperationResult[]> {
    const batchSize = 200; // Max supported batch size
    const batches = createBatches(data, batchSize);
    const responses: SalesforceBulkUpdateOperationResult[] = [];

    for (const batch of batches) {
      const response = await this.restApi().patch(
        `/services/data/${SalesforceClient.ApiVersion}/composite/sobjects`,
        {
          allOrNone,
          records: batch,
        },
        config,
      );
      responses.push(...response.data);
    }

    return responses;
  }

  /**
   * Invoke Apex REST Endpoint
   * @param method HTTP Method
   * @param path Endpoint Path
   * @param params Optional params
   * @param config Optional config
   */
  public async invokeApexRest(
    method: Method,
    path: string,
    params?: Record<string, string>,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    return await this.restApi().request({
      url: `/services/apexrest/${path}`,
      method,
      params,
      ...config,
    });
  }

  /**
   * Invoke a Salesforce Flow
   * @param name Flow name
   * @param input Flow input object
   * @param config Optional config
   */
  public async invokeFlow(name: string, input?: any, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return await this.restApi().request({
      method: 'POST',
      url: `/services/data/${SalesforceClient.ApiVersion}/actions/custom/flow/${name}`,
      data: input,
      ...config,
    });
  }

  /**
   * Invoke an Invokable Apex Class
   * @param className Class name
   * @param input Input object
   * @param config Optional config
   */
  public async invokeInvokableClass(
    className: string,
    input?: any,
    config?: AxiosRequestConfig,
  ): Promise<AxiosResponse> {
    return await this.restApi().request({
      method: 'POST',
      url: `/services/data/${SalesforceClient.ApiVersion}/actions/custom/apex/${className}`,
      data: input,
      ...config,
    });
  }

  /**
   * Execute anonymous Apex code
   * @param apexCode The Apex code to execute
   * @param config optional additional configuration
   */
  public async executeAnonymousApex(
    apexCode: string,
    config?: AxiosRequestConfig,
  ): Promise<SalesforceAnonymousApexExecutionResult> {
    const response = await this.restApi().get(
      `/services/data/${SalesforceClient.ApiVersion}/tooling/executeAnonymous`,
      {
        params: {
          anonymousBody: apexCode.trim(),
        },
        ...config,
      },
    );
    return response.data;
  }

  /**
   * Perform SOQL query and return the data.
   * Built-in pagination support.
   * @param query
   * @param config optional additional configuration
   */
  public async querySOQL<T>(query: string, config?: AxiosRequestConfig): Promise<T[]> {
    let response = await this.querySOQLResponse<T>(query, config);
    if (response.nextRecordsUrl == null) {
      return response.records ?? [];
    } else {
      // We have more records to fetch
      const allRecords: T[] = response.records ?? [];
      while (response.nextRecordsUrl != null) {
        response = await this.querySOQLUrl<T>(response.nextRecordsUrl, config);
        allRecords.push(...(response.records ?? []));
      }
      return allRecords;
    }
  }

  /**
   * Perform SOQL query and return the full response entity
   * @param q
   * @param config optional additional configuration
   * @deprecated Only exist for compatibility, do not use in the new code
   */
  public async querySOQLResponse<T>(q: string, config?: AxiosRequestConfig): Promise<SalesforceQueryResponse<T>> {
    return (await this.queryAxiosResponse<SalesforceQueryResponse<T>>(q, config)).data;
  }

  /**
   * Perform SOQL query and return the axios response entity
   * @param q
   * @param config optional additional configuration
   * @deprecated Only exist for compatibility, do not use in the new code
   */
  public async queryAxiosResponse<T>(q: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return await this.restApi().get(`/services/data/${SalesforceClient.ApiVersion}/query`, {
      params: { q: q.trim() },
      ...config,
    });
  }

  /**
   * Query Salesforce using an arbitrary URL. Typically used for the nextRecordsUrl processing
   * @param url
   * @param config optional additional configuration
   */
  public async querySOQLUrl<T>(url: string, config?: AxiosRequestConfig): Promise<SalesforceQueryResponse<T>> {
    const response = await this.restApi().get(url, config);
    return response.data;
  }
}

/**
 * Create batches of a specified size from an array
 * @param data Array of objects to batch
 * @param batchSize Size of each batch
 */
function createBatches<T>(data: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < data.length; i += batchSize) {
    batches.push(data.slice(i, i + batchSize));
  }
  return batches;
}

export interface SalesforceQueryResponse<T> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

export interface SalesforceAnonymousApexExecutionResult {
  compiled: boolean;
  success: boolean;
  compileProblem: string | null;
  exceptionStackTrace: string | null;
  exceptionMessage: string | null;
  line?: number; // If error
  column?: number; // If error
}

export interface SalesforceBulkUpdateEntity {
  attributes: {
    type: string;
  };
  id: string;
  [key: string]: any;
}

export interface SalesforceBulkUpdateOperationResult {
  id?: string;
  success: boolean;
  errors?: {
    statusCode: string;
    message: string;
    fields: string[];
  }[];
}
