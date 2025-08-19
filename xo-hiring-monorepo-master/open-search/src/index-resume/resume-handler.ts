import { ContentType } from 'aws-sdk/clients/s3';
import { OpenSearchConfig } from '../common/configs';
import { EmbeddingGenerator } from '../common/embedding-util';
import { VECTOR_SEARCH_DIMENSION } from '../common/index-mappings';
import { OpenSearchClient } from '../common/open-search-util';
import { VectorSearchClient } from '../common/vector-search-util';
import { OpenAIConfig } from '../common/openai-util';
import { ResumeSummarizer } from '../common/resume-summarizer';
import { S3Utils } from '../common/s3-utils';
import { StringUtils } from '../common/string-utils';
import { IndexItemMessage } from '../common/types';
import { DocParser } from './doc-parser';
import { DocumentTypeParser } from './doc-type-parser';
import { DocxParser } from './docx-parser';
import { MimeType } from './mime-type';
import { PdfParser } from './pdf-parser';

export class ResumeHandler {
  private readonly s3: S3Utils;
  private readonly embeddingGenerator: EmbeddingGenerator;
  private readonly searchClient: OpenSearchClient;
  private readonly vectorSearchClient: VectorSearchClient;
  private readonly aliasName: string;
  private readonly resumeSummarizer = new ResumeSummarizer();

  constructor(
    searchClient: OpenSearchClient,
    vectorSearchClient: VectorSearchClient,
    openSearchConfig: OpenSearchConfig,
    openAiConfig: OpenAIConfig,
  ) {
    if (!process.env.RESUME_BUCKET_NAME) {
      throw new Error('Resume bucket env variable is not defined');
    }
    this.s3 = new S3Utils(process.env.RESUME_BUCKET_NAME);
    this.embeddingGenerator = new EmbeddingGenerator(openAiConfig);
    this.searchClient = searchClient;
    this.vectorSearchClient = vectorSearchClient;
    this.aliasName = openSearchConfig.aliasName;
  }

  async update(message: IndexItemMessage) {
    const { candidateId } = message;

    if (!candidateId) {
      console.warn(`candidateId is undefined, quitting`);
      return;
    }

    console.log(`Updating resume for candidate Id: ${candidateId}`);

    const s3Resource = await this.s3.downloadS3File(candidateId);
    if (!s3Resource) {
      console.warn(`Didn't manage to download resume for candidate ${candidateId}; skip further processing`);
      return;
    }

    const contentType = await new DocumentTypeParser().defineContentType(s3Resource);
    console.info(`Downloaded resume for candidate ${candidateId}; content type: ${contentType}`);

    const documentExists = await this.searchClient.exists(this.aliasName, candidateId);
    if (!documentExists) {
      console.warn(`No indexed document exists for id: ${candidateId}; skip further processing`);
      return;
    }

    const resumeFile = await this.parseDocument(contentType, s3Resource.data);
    if (!resumeFile) {
      console.warn(`Failed to parse resume for candidate ${candidateId}; skip further processing`);
      return;
    }

    // Update generic index
    await this.searchClient.updateDocument(this.aliasName, candidateId, { resumeFile: resumeFile });

    // Update vector search index
    const profileText = await this.getResumeProfile(candidateId);
    const resumeText = await this.resumeSummarizer.summarize(resumeFile, profileText);
    await this.indexDocument(candidateId, resumeText);
  }

  private async parseDocument(contentType: ContentType | undefined, data: Buffer): Promise<string | undefined> {
    try {
      let text;
      switch (contentType) {
        case MimeType.PDF:
          text = await new PdfParser().getTextContent(data);
          break;
        case MimeType.OPEN_XML_FORMATS:
        case MimeType.WORDPROCESSINGML_DOC:
          text = await new DocxParser().getTextContent(data);
          break;
        case MimeType.MS_WORD:
        case MimeType.X_CFB:
          text = await new DocParser().getTextContent(data);
          break;
        default:
          console.warn(`Unsupported or unknown resume document content type: ${contentType}`);
      }
      return StringUtils.normalize(text);
    } catch (err) {
      console.error(`Failed to parse document with content type ${contentType}; skip further processing`, err);
    }
  }

  async remove(message: IndexItemMessage) {
    const { candidateId } = message;
    if (!candidateId) {
      console.warn(`candidateId is undefined, quitting`);
      return;
    }

    console.log(`Removing resume: ${candidateId}`);

    await this.searchClient.updateDocument(this.aliasName, candidateId as string, { resumeFile: null });
    await this.vectorSearchClient.indexDocuments(
      this.aliasName,
      [{ candidateId, resumeText: null, resumeVector: null }],
      true,
    );
  }

  private async indexDocument(candidateId: string, resumeText: string) {
    try {
      const embeddings = await this.embeddingGenerator.createEmbeddings(resumeText, VECTOR_SEARCH_DIMENSION);

      if (embeddings) {
        console.log(`Adding vector search document for candidate ${candidateId}, chunks: ${embeddings.length}`);

        // Index documents with vector only
        await this.vectorSearchClient.indexDocuments(
          this.aliasName,
          embeddings.map((resumeVector) => ({ candidateId, resumeVector, resumeText })),
          true,
        );

        console.log(`Added vector search document for candidate ${candidateId}`);
      } else {
        console.warn(`No embeddings created for candidate ${candidateId}`);
      }
    } catch (error) {
      console.error(`Error adding vector search document for candidate ${candidateId}:`, error);
    }
  }

  private async getResumeProfile(candidateId: string): Promise<string> {
    try {
      const doc = await this.searchClient.getDocument(this.aliasName, candidateId);
      return doc?.body?.['_source']?.resumeProfile ?? '';
    } catch (error) {
      return '';
    }
  }
}
