import { OpenSearchConfig } from '../common/configs';
import { OpenSearchClient } from '../common/open-search-util';
import { S3Utils } from '../common/s3-utils';
import { IndexItemMessage } from '../common/types';
import { VectorSearchClient } from '../common/vector-search-util';
import { BfqParserFactory } from './bfq-parser';

export class BfqHandler {
  private readonly s3: S3Utils;
  private readonly client: OpenSearchClient;
  private readonly vectorSearchClient: VectorSearchClient;
  private readonly aliasName: string;

  constructor(config: OpenSearchConfig) {
    if (!process.env.BFQS_BUCKET_NAME) {
      throw new Error('BFQs bucket env variable is not defined');
    }
    this.s3 = new S3Utils(process.env.BFQS_BUCKET_NAME);
    this.aliasName = config.aliasName;

    if (!process.env.COLLECTION_ENDPOINT) {
      throw new Error('Required env vars are missing: COLLECTION_ENDPOINT');
    }
    this.client = new OpenSearchClient(config.serviceName, process.env.COLLECTION_ENDPOINT);

    if (!process.env.VECTOR_SEARCH_COLLECTION_ENDPOINT) {
      throw new Error('Required env vars are missing: VECTOR_SEARCH_COLLECTION_ENDPOINT');
    }
    this.vectorSearchClient = new VectorSearchClient(config.serviceName, process.env.VECTOR_SEARCH_COLLECTION_ENDPOINT);
  }

  async update(message: IndexItemMessage) {
    const { candidateId } = message;

    if (!candidateId || !message.objectKey) {
      console.warn(`candidateId is undefined, quitting`);
      return;
    }

    console.log(`Updating BFQ answers for candidate Id: ${candidateId}`);

    const documentExists = await this.client.exists(this.aliasName, candidateId);
    if (!documentExists) {
      console.warn(`No indexed document exists for id: ${candidateId}; skip further processing`);
      return;
    }

    const factory = new BfqParserFactory(this.s3);
    const parser = await factory.createParser(message.objectKey);
    if (!parser) {
      console.warn(`Failed to create parser for objectKey: ${message.objectKey}; skip further processing`);
      return;
    }

    const bfqAnswersS3Resource = await this.s3.downloadS3File(message.objectKey);
    if (bfqAnswersS3Resource) {
      console.log(`Downloaded BFQ answers for candidate ${candidateId}`);
      try {
        const bfqAnswers = parser.parse(bfqAnswersS3Resource.data);
        if (bfqAnswers) {
          await this.client.updateDocument(this.aliasName, candidateId, { ...bfqAnswers });
          // Index documents with metadata only
          await this.vectorSearchClient.indexDocuments(this.aliasName, [{ candidateId, ...bfqAnswers }], false);
        }
      } catch (err) {
        console.error(`Failed to parse BFQ answers; skip further processing`, err);
      }
    } else {
      console.warn(`Didn't manage to download BFQ answers for candidate ${candidateId}; skip further processing`);
    }
  }

  async remove(message: IndexItemMessage) {
    const { candidateId } = message;
    if (!candidateId || !message.objectKey) {
      console.warn(`candidateId is undefined, exiting`);
      return;
    }

    if (message.objectKey.startsWith('answers/')) {
      console.log(`Removing BFQ answers: ${candidateId}`);
      const diff = {
        acceptableCompensation: null,
        desiredCompensation: null,
        workingHours: null,
        availabilityToStart: null,
        domains: null,
        bfqAnswers: null,
        bfqKeywords: null,
      };
      await this.client.updateDocument(this.aliasName, candidateId as string, diff);
      await this.vectorSearchClient.indexDocuments(this.aliasName, [{ candidateId, ...diff }], false);
    } else if (message.objectKey.startsWith('job-role-answers/')) {
      console.log(`Removing job role BFQ answers: ${candidateId}`);
      const diff = {
        careerGoals: null,
        currentCompensationPeriod: null,
        currentCompensation: null,
      };
      await this.client.updateDocument(this.aliasName, candidateId as string, diff);
      await this.vectorSearchClient.indexDocuments(this.aliasName, [{ candidateId, ...diff }], false);
    }
  }
}
