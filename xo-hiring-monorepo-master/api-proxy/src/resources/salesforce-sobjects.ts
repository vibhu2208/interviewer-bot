import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';
import { APIGatewayProxyEvent, APIGatewayProxyEventHeaders } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { passRequestHeaders } from '../http';
import { SalesforceRest } from '../urls';
import { SalesforceIdParameter } from '../validation';

async function invokeSObjectApi(
  method: 'post' | 'patch' | 'delete',
  url: string,
  data: string | null,
  headers: APIGatewayProxyEventHeaders,
): Promise<AxiosResponse> {
  const client = await getSalesforceClient();

  return client.request({
    method,
    url,
    data,
    headers: passRequestHeaders(headers),
  });
}

export async function createSObject(event: APIGatewayProxyEvent, objectType: string) {
  return invokeSObjectApi('post', `${SalesforceRest.sobjects}${objectType}`, event.body, event.headers);
}

export async function deleteSObject(event: APIGatewayProxyEvent, objectType: string, objectId: SalesforceIdParameter) {
  return invokeSObjectApi('delete', `${SalesforceRest.sobjects}${objectType}/${objectId}`, event.body, event.headers);
}

export async function patchSObject(event: APIGatewayProxyEvent, objectType: string, objectId: SalesforceIdParameter) {
  return invokeSObjectApi('patch', `${SalesforceRest.sobjects}${objectType}/${objectId}`, event.body, event.headers);
}
