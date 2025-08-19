import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { passRequestHeaders } from '../http';
import { SalesforceRest } from '../urls';
import { SafeParameter } from '../validation';
import { AxiosRequestConfig, AxiosResponse } from 'axios';

export async function invokeApexrest(
  event: APIGatewayProxyEvent,
  method: 'get' | 'post' | 'put' | 'patch',
  path: string,
  params?: Record<string, SafeParameter | undefined>,
  additionalConfig?: AxiosRequestConfig,
): Promise<AxiosResponse> {
  const client = await getSalesforceClient();

  return client.request({
    method: method,
    url: `${SalesforceRest.apexrest}${path}`,
    params: params,
    headers: passRequestHeaders(event.headers),
    data: method == 'get' ? undefined : event.body,
    ...additionalConfig,
  });
}
