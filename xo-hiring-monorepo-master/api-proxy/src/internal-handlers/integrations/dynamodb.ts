import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument, PutCommandOutput, QueryCommandInput, UpdateCommandOutput } from '@aws-sdk/lib-dynamodb';

export interface MainTableKeys {
  pk: string;
  sk: string;
}

const ddbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

export const ddbDocumentClient = DynamoDBDocument.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export async function getItem<T extends MainTableKeys>(tableName: string, key: MainTableKeys): Promise<T | null> {
  const result = await ddbDocumentClient.get({
    TableName: tableName,
    Key: key,
  });
  return (result?.Item as T) ?? null;
}

export async function putItem<T extends MainTableKeys>(tableName: string, item: T): Promise<PutCommandOutput> {
  return ddbDocumentClient.put({
    TableName: tableName,
    Item: item,
  });
}

export async function updateItem(
  tableName: string,
  key: MainTableKeys,
  updateExpression: string,
  conditionExpression: string,
  expressionAttributeNames: Record<string, string>,
  expressionAttributeValues: Record<string, any>,
): Promise<UpdateCommandOutput> {
  return ddbDocumentClient.update({
    TableName: tableName,
    Key: key,
    UpdateExpression: updateExpression,
    ConditionExpression: conditionExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  });
}

export async function batchGetItems<T extends MainTableKeys>(keys: MainTableKeys[], tableName: string): Promise<T[]> {
  const response = await ddbDocumentClient.batchGet({
    RequestItems: {
      [tableName]: {
        Keys: keys,
      },
    },
  });
  return (response.Responses?.[tableName] as T[]) ?? [];
}

export async function queryItemsByPk<T extends MainTableKeys>(
  pk: string,
  tableName: string,
  skPrefix?: string,
): Promise<T[]> {
  const params: QueryCommandInput = {
    TableName: tableName,
    KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :skPrefix)' : 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': pk,
      ...(skPrefix && { ':skPrefix': skPrefix }),
    },
  };

  const response = await ddbDocumentClient.query(params);
  return (response.Items as T[]) ?? [];
}

export function envVal(name: string): string {
  const val = process.env[name];
  if (val == null) {
    throw new Error(`Environment variable '${name}' is required but not set`);
  }
  return val;
}
