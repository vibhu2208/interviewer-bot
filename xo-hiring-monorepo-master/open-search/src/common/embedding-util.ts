import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIConfig } from './openai-util';

/**
 * Utility class for generating embeddings with LangChain's text chunking.
 *
 * Chunking configuration:
 * - chunkSize: 20000 characters (< 8192 tokens) - balances context size with API costs
 * - chunkOverlap: 400 characters (10% overlap) - maintains context between chunks
 * - Uses hierarchical splitting: paragraphs → sections → sentences → words
 *
 * Note: OpenAI's text-embedding-3-small has a max limit of 8192 tokens (~32,000 chars),
 * but smaller chunks are used for better semantic granularity and search precision.
 */
export class EmbeddingGenerator {
  private readonly embeddings: OpenAIEmbeddings;
  private readonly textSplitter: RecursiveCharacterTextSplitter;

  constructor(openAiConfig: OpenAIConfig) {
    this.embeddings = new OpenAIEmbeddings({ apiKey: openAiConfig.jobRecommender, model: 'text-embedding-3-small' });

    // Configure text splitter with settings optimized for resumes
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 20000,
      chunkOverlap: 400,
      separators: [
        '\n\n\n', // Multiple line breaks (likely section boundaries)
        '\n\n', // Paragraph breaks
        '\n', // Line breaks
        '.', // Sentences
        '!', // Exclamations (sentence boundaries)
        '?', // Questions (sentence boundaries)
        ';', // Semi-colons (phrase boundaries)
        ',', // Commas (clause boundaries)
        ' ', // Words
        '', // Characters
      ],
      lengthFunction: (text) => text.length,
    });
  }

  public async createEmbeddings(text: string, dimensions: number): Promise<number[][] | undefined> {
    try {
      // Split text into chunks using LangChain's sophisticated chunking
      const chunks = await this.textSplitter.createDocuments([text]);
      const embeddings: number[][] = [];

      // Generate embeddings for each chunk
      for (const chunk of chunks) {
        const embedding = await this.embeddings.embedQuery(chunk.pageContent);
        if (embedding && embedding.length === dimensions) {
          embeddings.push(embedding);
        }
      }

      return embeddings.length > 0 ? embeddings : undefined;
    } catch (error) {
      console.error('Error creating embedding:', error);
      return undefined;
    }
  }
}
