import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocument,
  PutCommandOutput,
  QueryCommandInput,
  QueryCommandOutput,
  UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { UpdateCommandInput } from '@aws-sdk/lib-dynamodb/dist-types/commands/UpdateCommand';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from 'aws-lambda/trigger/dynamodb-stream';
import { Logger } from '../common/logger';
import { Config } from '../config';

const log = Logger.create('ddb-integration');

const client = new DynamoDBClient({
  region: Config.getRegion(),
});

const documentClient = DynamoDBDocument.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export interface MainTableKeys {
  pk: string;
  sk: string;
}

export interface GSI1Keys {
  gsi1pk?: string;
  gsi1sk?: string;
}

export class DynamoDB {
  static async putDocument(document: Object): Promise<PutCommandOutput> {
    log.plain('PUT_DOCUMENT', document);
    return await documentClient.put({
      TableName: Config.getMainDdbTableName(),
      Item: document,
    });
  }

  static async getDocument<T>(key: MainTableKeys, consistentRead?: boolean): Promise<T | null> {
    const result = await documentClient.get({
      TableName: Config.getMainDdbTableName(),
      ConsistentRead: consistentRead,
      Key: key,
    });
    return (result?.Item as T) ?? null;
  }

  static async putDocuments(documents: Object[]): Promise<void> {
    log.plain('PUT_DOCUMENTS', documents);
    await documentClient.batchWrite({
      RequestItems: {
        [Config.getMainDdbTableName()]: documents.map((it) => ({
          PutRequest: {
            Item: it,
          },
        })),
      },
    });
  }

  static async getDocuments<T>(keys: MainTableKeys[]): Promise<T[]> {
    log.plain('GET_DOCUMENTS', keys);
    const response = await documentClient.batchGet({
      RequestItems: {
        [Config.getMainDdbTableName()]: {
          Keys: keys,
        },
      },
    });
    return (response.Responses?.[Config.getMainDdbTableName()] ?? []) as T[];
  }

  static async deleteDocuments(documents: MainTableKeys[]): Promise<void> {
    log.plain('DELETE_DOCUMENTS', documents);

    if (documents.length === 0) {
      return;
    }

    await documentClient.batchWrite({
      RequestItems: {
        [Config.getMainDdbTableName()]: documents.map((it) => ({
          DeleteRequest: {
            Key: {
              pk: it.pk,
              sk: it.sk,
            },
          },
        })),
      },
    });
  }

  static async updateDocument(config: Omit<UpdateCommandInput, 'TableName'>): Promise<UpdateCommandOutput> {
    return await documentClient.update({
      TableName: Config.getMainDdbTableName(),
      ...config,
    });
  }

  static async query(config: Omit<QueryCommandInput, 'TableName'>): Promise<QueryCommandOutput> {
    return await documentClient.query({
      TableName: Config.getMainDdbTableName(),
      ...config,
    });
  }

  /**
   * Convert a DynamoDB record into a JavaScript object
   * @param ddbRawData DDB record
   */
  static unmarshall<T>(ddbRawData: { [key: string]: AttributeValue } | undefined): T | null {
    if (ddbRawData == null) {
      return null;
    }
    // @ts-ignore AWS Libraries seems to have a bit of typing clash here
    return unmarshall(ddbRawData) as T;
  }
}
