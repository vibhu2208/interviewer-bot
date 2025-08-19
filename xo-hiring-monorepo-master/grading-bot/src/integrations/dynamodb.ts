import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocument,
  PutCommandOutput,
  QueryCommandInput,
  QueryCommandOutput,
  UpdateCommandOutput,
} from '@aws-sdk/lib-dynamodb';
import { UpdateCommandInput } from '@aws-sdk/lib-dynamodb/dist-types/commands/UpdateCommand';
import { AttributeValue } from 'aws-sdk/clients/dynamodbstreams';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Logger } from '../common/logger';
import { sliceIntoChunks } from '../common/util';
import { Config } from '../config';

const log = Logger.create('dynamodb');
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

export class DynamoDB {
  static async putDocument(document: object): Promise<PutCommandOutput> {
    log.plain('PUT_DOCUMENT', document);
    return await documentClient.put({
      TableName: Config.getMainDdbTableName(),
      Item: document,
    });
  }

  static async getDocument<T>(key: MainTableKeys): Promise<T | null> {
    const result = await documentClient.get({
      TableName: Config.getMainDdbTableName(),
      Key: key,
    });
    return (result?.Item as T) ?? null;
  }

  static async putDocuments(documents: object[], splitIntoBatchOf?: number): Promise<void> {
    log.plain('PUT_DOCUMENTS', documents);
    const chunks = sliceIntoChunks(documents, splitIntoBatchOf ?? documents.length);
    for (const chunk of chunks) {
      await documentClient.batchWrite({
        RequestItems: {
          [Config.getMainDdbTableName()]: chunk.map((it) => ({
            PutRequest: {
              Item: it,
            },
          })),
        },
      });
    }
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
  static unmarshall<T>(ddbRawData: { [p: string]: AttributeValue }): T | null {
    if (ddbRawData == null) {
      return null;
    }
    // @ts-ignore AWS Libraries seems to have a bit of typing clash here
    return unmarshall(ddbRawData) as T;
  }
}
