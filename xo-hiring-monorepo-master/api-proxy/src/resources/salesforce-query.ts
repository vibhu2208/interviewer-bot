import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { passRequestHeaders } from '../http';
import { SalesforceRest } from '../urls';

export async function query(event: APIGatewayProxyEvent, q: string): Promise<AxiosResponse> {
  const client = await getSalesforceClient();
  return client.get(SalesforceRest.query, {
    params: { q },
    headers: passRequestHeaders(event.headers),
  });
}
