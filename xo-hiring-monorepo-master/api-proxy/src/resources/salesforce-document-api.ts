import { getSalesforceDocumentClient } from '@trilogy-group/xo-hiring-integration';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { passRequestHeaders } from '../http';

export async function getProfilephoto(event: APIGatewayProxyEvent, id: string): Promise<AxiosResponse> {
  const client = await getSalesforceDocumentClient();
  return client.get(`/profilephoto/${id}/M`, {
    headers: passRequestHeaders(event.headers),
    responseType: 'arraybuffer',
  });
}
