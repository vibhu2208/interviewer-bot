import { setLogger } from '@trilogy-group/xo-hiring-integration';
import { defaultLogger } from '@trilogy-group/xoh-integration';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { isAxiosError } from 'axios';

export const logger = defaultLogger({ serviceName: 'api-proxy' });

const sfLogger = logger.createChild({ serviceName: 'sf-integration' });

// Update old salesforce logger to use the new logger
setLogger(sfLogger as any);

/**
 * Return the valuable fields from the ApiGateway event that would be included into the error log
 * @param event
 */
export function valuableRequestFields(event: APIGatewayProxyEvent) {
  return {
    method: event.httpMethod,
    resource: event.resource,
    path: event.path,
  };
}

/**
 * Return the improved log representation of the axios error that does not contain unrelated information.
 * Would return object as-is for non-axios errors
 * @param error any kind of error (or event object)
 */
export function importantFromAxiosError(error: any) {
  if (isAxiosError(error)) {
    return {
      status: error.status,
      message: error.message,
      code: error.code,
      request: {
        method: error.config?.method,
        baseURL: error.config?.baseURL,
        url: error.config?.url,
        headers: error.config?.headers,
        data: error.config?.data,
        params: error.config?.params,
      },
      response: {
        data: error.response?.data,
      },
      stack: error.stack,
    };
  } else {
    // Log
    return error;
  }
}
