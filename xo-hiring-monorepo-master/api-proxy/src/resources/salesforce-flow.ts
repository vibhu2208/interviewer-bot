import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { passRequestHeaders } from '../http';
import { SalesforceRest } from '../urls';

export async function invokeFlow(event: APIGatewayProxyEvent, flowName: string): Promise<AxiosResponse> {
  const client = await getSalesforceClient();
  return client.request({
    method: 'post',
    url: `${SalesforceRest.flow}${flowName}`,
    headers: passRequestHeaders(event.headers),
    data: event.body,
  });
}
