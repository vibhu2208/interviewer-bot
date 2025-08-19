import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  PutCommandOutput,
  QueryCommand,
  QueryCommandInput,
  QueryCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const dynamoDBClient = new DynamoDBClient();
const documentClient = DynamoDBDocumentClient.from(dynamoDBClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

export interface MainTableKeys {
  pk: string;
  sk: string;
}

export interface DdbDocument {
  createdAt?: string;
  updatedAt?: string;
}

export class DynamoDB {
  static async putDocument(
    document: MainTableKeys & DdbDocument,
    tableName = process.env.DDB_DATA_TABLE_NAME,
  ): Promise<PutCommandOutput> {
    if (document.createdAt == null) {
      document.createdAt = new Date().toISOString();
    }
    document.updatedAt = new Date().toISOString();

    return await documentClient.send(
      new PutCommand({
        TableName: tableName,
        Item: document,
      }),
    );
  }

  static async getDocument<T>(
    key: MainTableKeys,
    consistentRead = false,
    tableName = process.env.DDB_DATA_TABLE_NAME,
  ): Promise<T | null> {
    const result = await documentClient.send(
      new GetCommand({
        Key: key,
        TableName: tableName,
        ConsistentRead: consistentRead,
      }),
    );

    return (result.Item as T) ?? null;
  }

  static async getDocuments<T>(keys: MainTableKeys[], tableName = process.env.DDB_DATA_TABLE_NAME): Promise<T[]> {
    if (!tableName) {
      throw new Error('Table name is required');
    }

    const results = await documentClient.send(new BatchGetCommand({ RequestItems: { [tableName]: { Keys: keys } } }));
    return results.Responses?.[tableName] as T[];
  }

  static async query(
    config: Omit<QueryCommandInput, 'TableName'>,
    tableName = process.env.DDB_DATA_TABLE_NAME,
  ): Promise<QueryCommandOutput> {
    return await documentClient.send(
      new QueryCommand({
        TableName: tableName,
        ...config,
      }),
    );
  }

  static unmarshall<T>(ddbRawData: Record<string, unknown>): T | null {
    if (ddbRawData == null) {
      return null;
    }
    // @ts-ignore AWS Libraries seems to have a bit of typing clash here
    return unmarshall(ddbRawData) as T;
  }
}
