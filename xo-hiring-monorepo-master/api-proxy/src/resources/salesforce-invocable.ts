import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { passRequestHeaders } from '../http';
import { SalesforceRest } from '../urls';

export type InvocablePayload = {
  inputs: object[];
};

export async function invokeInvocable(
  event: APIGatewayProxyEvent,
  className: string,
  payload?: InvocablePayload | undefined,
): Promise<AxiosResponse> {
  const client = await getSalesforceClient();
  return client.request({
    method: 'post',
    url: `${SalesforceRest.invocable}${className}`,
    headers: passRequestHeaders(event.headers),
    data: payload || event.body,
  });
}
