// @ts-nocheck
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node'; // V3 SDK.
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { ApiResponse } from '@opensearch-project/opensearch/lib/Transport';

// Created or updated
const UPDATED_STATUS = 200;
const CREATED_STATUS = 201;
const SUCCESS_STATUSES = [UPDATED_STATUS, CREATED_STATUS];
const INDEX_PREFIX = 'candidates';

export type IndexingResult = {
  indexedCount: number;

  created: string[];
};

interface CopyAllDataResponse {
  done: boolean;
  hits: number;
  searchAfter?: string;
}
export class OpenSearchClient {
  private readonly client: Client;
  constructor(serviceName: string, endpoint: string) {
    this.client = new Client({
      ...AwsSigv4Signer({
        region: process.env.AWS_REGION,
        service: serviceName,
        // Example with AWS SDK V3:
        getCredentials: () => {
          // Any other method to acquire a new Credentials object can be used.
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: endpoint,
    });
  }

  public async initializeAlias(aliasName: string, configuration: Record<string, unknown>): Promise<void> {
    const { body: aliasExists } = await this.client.indices.existsAlias({
      name: aliasName,
    });

    if (aliasExists) {
      console.log(`Skip creating already existing alias "${aliasName}"`);
    } else {
      const indexName = `${INDEX_PREFIX}_${Date.now()}`;
      console.log(`Creating index: ${indexName}`);
      await this.client.indices.create({
        index: indexName,
        body: configuration[aliasName],
      });
      console.log(`Index "${indexName}" created`);

      console.log(`Creating alias: ${aliasName} for index: ${indexName}`);

      await this.client.indices.updateAliases({
        body: {
          actions: [{ add: { index: indexName, alias: aliasName, is_write_index: true } }],
        },
      });

      console.log(`Alias "${aliasName}" created for index "${indexName}"`);
    }
  }

  public async createIndexWithMappingForAlias(
    indexName: string,
    aliasName: string,
    configuration: Record<string, unknown>,
  ): Promise<void> {
    const { body: indexExists } = await this.client.indices.exists({
      index: indexName,
    });

    if (indexExists) {
      console.log(`Skip creating already existing index "${indexName}"`);
    } else {
      console.log(`Creating index: ${indexName}`);
      await this.client.indices.create({
        index: indexName,
        body: configuration[aliasName],
      });
      console.log(`index "${indexName}" created`);
    }
  }

  public async updateIndicesForAlias(sourceIndex: string, destIndex: string, aliasName: string): Promise<void> {
    // Point destIndex to alias
    await this.client.indices.updateAliases({
      body: {
        actions: [
          { remove: { index: sourceIndex, alias: aliasName } },
          { add: { index: destIndex, alias: aliasName, is_write_index: true } },
        ],
      },
    });

    // For now deleting the old index will be done manually
    // Delete sourceIndex
    // await this.client.indices.delete({ index: sourceIndex });
  }

  public async searchDataForReindexing(sourceIndex: string, searchAfter: string | undefined): Promise<never> {
    const batchSize = 1000;

    const query = {
      index: sourceIndex,
      size: batchSize,
      sort: ['candidateId'],
      body: {
        query: { match_all: {} },
      },
    };

    if (searchAfter) {
      query.body.search_after = [searchAfter];
    }

    const response = await this.client.search(query);

    return response.body.hits.hits;
  }

  public async saveDataForReindexing(destIndex: string, hits: never): Promise<CopyAllDataResponse> {
    if (hits.length === 0) {
      return {
        done: true,
        hits: hits.length,
      };
    }

    const bulkActions = hits.flatMap((hit) => [{ index: { _index: destIndex, _id: hit._id } }, hit._source]);

    await this.client.bulk({ body: bulkActions });

    return {
      done: false,
      hits: hits.length,
      searchAfter: hits[hits.length - 1].sort[0],
    };
  }

  public async exists(aliasName: string, id: string): Promise<boolean> {
    const { body } = await this.client.exists({
      index: aliasName,
      id,
    });
    return body;
  }

  public async getDocument(aliasName: string, id: string): Promise<ApiResponse> {
    return await this.client.get({
      index: aliasName,
      id,
    });
  }

  public async addDocuments(aliasName: string, documents: object[]): Promise<IndexingResult> {
    console.log('Adding documents:' + documents.length);

    const body = [];
    for (const doc of documents) {
      body.push({ update: { _index: aliasName, _id: doc.candidateId } });
      body.push({ doc, doc_as_upsert: true });
    }

    const response = await this.client.bulk({
      body,
    });

    const {
      body: { items },
    } = response;

    const created = items.filter((item) => CREATED_STATUS === item.update.status).map((item) => item['update']['_id']);
    const indexedCount = items.filter((item) => SUCCESS_STATUSES.includes(item.update.status)).length;

    console.log(`Indexed documents: ${indexedCount}`);
    return { indexedCount, created };
  }

  public async updateDocument(aliasName: string, id: string, doc: object): Promise<void> {
    try {
      const {
        body: { result },
        statusCode,
      } = (await this.client.update({
        id,
        index: aliasName,
        body: { doc },
      })) as ApiResponse;

      console.log(`Update document for id "${id}" status code ${statusCode}; result: ${result}`);
    } catch (error) {
      console.error(`Error updating document for id ${id}:`, error);
    }
  }
}
