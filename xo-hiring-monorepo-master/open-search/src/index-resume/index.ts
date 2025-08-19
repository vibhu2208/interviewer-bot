import { SecretsManager } from '@trilogy-group/xoh-integration';
import { SQSEvent } from 'aws-lambda';
import { initLambda } from '../common/configs';
import { EventParser } from '../common/event-parser';
import { OpenSearchClient } from '../common/open-search-util';
import { OpenAIConfig } from '../common/openai-util';
import { VectorSearchClient } from '../common/vector-search-util';
import { ResumeHandler } from './resume-handler';

export async function handler(event: SQSEvent) {
  console.log(`Execute Index resume Lambda; event:${JSON.stringify(event, null, 2)}`);

  const { config: openSearchConfig } = await initLambda();

  // Initialize OpenAI
  if (!process.env.OPENAI_SECRET_NAME) {
    throw new Error(`OPENAI_SECRET_NAME env variable should be defined`);
  }
  const openAiConfig = await SecretsManager.fetchSecretJson<OpenAIConfig>(process.env.OPENAI_SECRET_NAME);
  if (openAiConfig == null) {
    throw new Error(`OpenAI configuration is not available`);
  }

  // Initialize OpenSearch SEARCH
  if (!process.env.COLLECTION_ENDPOINT) {
    throw new Error('Required env vars are missing: COLLECTION_ENDPOINT');
  }
  const searchClient = new OpenSearchClient(openSearchConfig.serviceName, process.env.COLLECTION_ENDPOINT);

  // Initialize OpenSearch VECTORSEARCH
  if (!process.env.VECTOR_SEARCH_COLLECTION_ENDPOINT) {
    throw new Error('Required env vars are missing: VECTOR_SEARCH_COLLECTION_ENDPOINT');
  }
  const vectorSearchClient = new VectorSearchClient(
    openSearchConfig.serviceName,
    process.env.VECTOR_SEARCH_COLLECTION_ENDPOINT,
  );

  const resumeHandler = new ResumeHandler(searchClient, vectorSearchClient, openSearchConfig, openAiConfig);
  const eventParser = new EventParser();

  const { Records: records } = event;
  for (const record of records) {
    const messages = eventParser.parseEvent(record);
    for (const message of messages) {
      switch (message.operation) {
        case 'update':
          await resumeHandler.update(message);
          break;
        case 'remove':
          await resumeHandler.remove(message);
          break;
        default:
          console.warn(`Unknown operation: ${message.operation}; skip event processing`);
      }
    }
  }
}
