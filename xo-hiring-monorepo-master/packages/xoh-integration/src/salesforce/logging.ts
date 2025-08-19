import { AxiosError, AxiosInstance } from 'axios';
import { defaultLogger } from '../logger';

/**
 * Exposing the logger in case we need to configure level specifically for this one
 */
export const SalesforceIntegrationLogger = defaultLogger({ serviceName: `salesforce-integration` });

export class IntegrationLogger {
  /**
   * Configure interceptors for Axios instance in order to log every request and response
   * @param axiosInstance
   */
  setup(axiosInstance: AxiosInstance) {
    // Add a request interceptor
    axiosInstance.interceptors.request.use(
      (config) => {
        SalesforceIntegrationLogger.info('HTTP_REQUEST', {
          method: config.method,
          url: config.url,
          headers: config.headers,
          config,
        });
        return config;
      },
      (error: AxiosError) => {
        SalesforceIntegrationLogger.error('HTTP_REQUEST_ERROR', error);
        return Promise.reject(error);
      },
    );

    // Add a response interceptor
    axiosInstance.interceptors.response.use(
      (response) => {
        // Any status code that lie within the range of 2xx cause this function to trigger
        SalesforceIntegrationLogger.info('HTTP_REQUEST', {
          data: response.data,
          status: response.status,
          headers: response.headers,
        });
        return response;
      },
      (error: AxiosError) => {
        // Any status codes that falls outside the range of 2xx cause this function to trigger
        SalesforceIntegrationLogger.error('HTTP_RESPONSE_ERROR', {
          error: error.message,
          data: error.response?.data,
          status: error.response?.status,
          headers: error.response?.headers,
        });
        return Promise.reject(error);
      },
    );
  }
}
