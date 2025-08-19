import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';

export async function querySalesforce<T>(q: string): Promise<SalesforceResponse<T>> {
  const sfClient = await getSalesforceClient();

  const response = await sfClient.get('/services/data/v57.0/query', {
    params: { q: q.replace(/\n/, ' ') },
  });

  return response.data;
}

export interface SalesforceResponse<T> {
  totalSize: number;
  done: boolean;
  records: T[];
}
