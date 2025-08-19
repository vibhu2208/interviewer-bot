import { Client } from '@opensearch-project/opensearch';
import { ApiResponse } from '@opensearch-project/opensearch/lib/Transport';
import { createOpenSearchClient } from './opensearch-client';

// Created or updated
const UPDATED_STATUS = 200;
const CREATED_STATUS = 201;
const SUCCESS_STATUSES = [UPDATED_STATUS, CREATED_STATUS];
const INDEX_PREFIX = 'candidates';

export class VectorSearchClient {
  private readonly client: Client;

  constructor(serviceName: string, endpoint: string) {
    this.client = createOpenSearchClient(serviceName, endpoint);
  }

  /**
   * Initialize alias for vector search index
   * @param aliasName - alias name
   * @param configuration - index configuration
   */
  public async initializeAlias(aliasName: string, configuration: Record<string, any>): Promise<void> {
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

  /**
   * Index documents in bulk for vector search index
   * @param aliasName - alias name
   * @param documents - documents to index
   * @param updateVector - whether we are updating vector or metadata (cannot do both at the same time)
   */
  public async indexDocuments(
    aliasName: string,
    documents: { candidateId: string; resumeText?: string | null; resumeVector?: number[] | null }[],
    updateVector: boolean,
  ): Promise<{ indexedCount: number; updatedCount: number }> {
    // Get existing documents by candidateIds
    const candidateIds = documents.map((doc) => doc.candidateId);
    if (candidateIds.length === 0) {
      // Nothing to index
      console.log(`No candidateIds to index`);
      return { indexedCount: 0, updatedCount: 0 };
    }

    // If we are updating vector, then we need to retrieve existing documents for metadata, and then recreate documents with new vector
    if (updateVector) {
      const existingDocuments = await this.getDocumentsByCandidateIds(aliasName, candidateIds);

      // Get existing document ids to delete them from vector search
      const existingDocumentIds: string[] = existingDocuments.body.hits.hits.map((hit: any) => hit._id);

      // We need documents dictionary to ensure documents persist metadata when recreated
      const candidateIdToMetadata: Record<string, any> = {};
      for (const hit of existingDocuments.body.hits.hits) {
        const source = hit._source;
        candidateIdToMetadata[source.candidateId] = source;
      }

      // Enrich documents with metadata when it is present
      const documentsWithMetadata = documents.map((doc) => ({
        ...candidateIdToMetadata[doc.candidateId],
        ...doc,
      }));

      // Delete existing documents from vector search
      await this.deleteDocumentsBulk(aliasName, existingDocumentIds);

      // Index new documents with vector
      const indexedCount = await this.indexDocumentsBulk(aliasName, documentsWithMetadata);

      return { indexedCount, updatedCount: 0 };
    } else {
      // Updating or creating documents with metadata only

      // Get existing documents by candidateIds, we can have several documents with the same candidateId due to chunking
      const existingDocumentsResponse = await this.getDocumentsByCandidateIds(aliasName, candidateIds);
      const existingDocuments = existingDocumentsResponse.body.hits.hits;

      // Map metadata to candidateId
      const candidateIdToMetadata: Record<string, any> = {};
      for (const doc of documents) {
        candidateIdToMetadata[doc.candidateId] = doc;
      }

      // Update existing documents with new metadata
      const docsToUpdate = [];
      for (const doc of existingDocuments) {
        const source = doc._source;
        const updatedMetadata = candidateIdToMetadata[source.candidateId];
        docsToUpdate.push({ doc: { ...source, ...updatedMetadata }, id: doc._id });
      }

      const existingDocumentCandidateIds = docsToUpdate.map((doc) => doc.doc.candidateId);

      // Get documents which do not exist in the index yet
      const docsToIndex = documents.filter((doc) => !existingDocumentCandidateIds.includes(doc.candidateId));

      // Update existing documents with new metadata
      const updatedCount = await this.updateDocumentsBulk(aliasName, docsToUpdate);

      // Index new documents
      const indexedCount = await this.indexDocumentsBulk(aliasName, docsToIndex);

      return { indexedCount, updatedCount };
    }
  }

  /**
   * Get documents by candidateIds for VECTORSEARCH collection index. This query returns just one document
   * @param aliasName - alias name
   * @param candidateIds - candidateIds
   */
  private async getDocumentsByCandidateIds(aliasName: string, candidateIds: string[]): Promise<ApiResponse> {
    return await this.client.search({
      index: aliasName,
      size: 10000, // Use large size to ensure we get all documents
      body: {
        query: { terms: { candidateId: candidateIds } },
      },
    });
  }

  /**
   * Delete documents in bulk for VECTORSEARCH collection index
   * @param aliasName - alias name
   * @param documentIds - document ids
   */
  private async deleteDocumentsBulk(aliasName: string, documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) {
      console.log(`No documents to delete`);
      return;
    }

    console.log(`Deleting ${documentIds.length} documents`);
    try {
      const deleteResponse = await this.client.bulk({
        body: documentIds.map((id) => ({ delete: { _index: aliasName, _id: id } })),
      });

      const deletedCount = deleteResponse.body.items.filter((item: any) =>
        SUCCESS_STATUSES.includes(item.delete.status),
      ).length;

      console.log(`Deleted ${deletedCount} documents`);
    } catch (error) {
      console.error(`Error deleting documents:`, error);
    }
  }

  /**
   * Index documents in bulk for VECTORSEARCH collection index
   * @param aliasName - alias name
   * @param documents - documents to index
   */
  private async indexDocumentsBulk(aliasName: string, documents: object[]): Promise<number> {
    if (documents.length === 0) {
      console.log(`No documents to index`);
      return 0;
    }

    console.log(`Indexing ${documents.length} documents in index: ${aliasName}`);

    try {
      const body = [];
      for (const doc of documents) {
        // Do not send _id, because it is not supported in VECTORSEARCH
        body.push({ index: { _index: aliasName } });
        body.push(doc);
      }

      const response = await this.client.bulk({ body });
      const indexedCount = response.body.items.filter((item: any) =>
        SUCCESS_STATUSES.includes(item.index.status),
      ).length;
      console.log(`Indexed ${indexedCount} documents in index: ${aliasName}`);

      return indexedCount;
    } catch (error) {
      console.error(`Error indexing documents:`, error);

      return 0;
    }
  }

  /**
   * Update documents in bulk for VECTORSEARCH collection index
   * @param aliasName - alias name
   * @param documents - documents to update
   */
  private async updateDocumentsBulk(aliasName: string, documents: { doc: object; id: string }[]): Promise<number> {
    if (documents.length === 0) {
      console.log(`No documents to update`);
      return 0;
    }

    console.log(`Updating ${documents.length} documents in index: ${aliasName}`);

    try {
      const body = [];
      for (const { doc, id } of documents) {
        body.push({ update: { _index: aliasName, _id: id } });
        body.push({ doc });
      }

      const response = await this.client.bulk({ body });
      const updatedCount = response.body.items.filter((item: any) =>
        SUCCESS_STATUSES.includes(item.update.status),
      ).length;
      console.log(`Updated ${updatedCount} documents in index: ${aliasName}`);

      return updatedCount;
    } catch (error) {
      console.error(`Error updating documents:`, error);

      return 0;
    }
  }
}
