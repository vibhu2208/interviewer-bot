import * as docs from '@googleapis/docs';
import { CredentialBody } from 'google-auth-library/build/src/auth/credentials';
import { ContentExtraction } from '../common/content-extraction';
import { NonRetryableError } from '../common/non-retryable-error';
import { Config } from '../config';
import { Secrets } from './secrets';

let docsClient: docs.docs_v1.Docs;

export class GoogleDocs {
  static async getApiClient(credentials: CredentialBody): Promise<docs.docs_v1.Docs> {
    if (docsClient != null) {
      return docsClient;
    }
    const auth = new docs.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/documents'],
    });
    docsClient = docs.docs({
      version: 'v1',
      auth: auth,
    });
    return docsClient;
  }

  static async default(): Promise<docs.docs_v1.Docs> {
    if (docsClient != null) {
      return docsClient;
    }

    const credentials = await Secrets.fetchJsonSecret<CredentialBody>(Config.getGoogleCredentialsSecretName());
    return GoogleDocs.getApiClient(credentials);
  }

  static canBeGoogleDocument(url: string): boolean {
    return url.includes('docs.google.com/document');
  }

  static async getDocumentById(documentId: string): Promise<docs.docs_v1.Schema$Body> {
    let document: docs.docs_v1.Schema$Document;
    try {
      const client = await GoogleDocs.default();
      document = (
        await client.documents.get({
          documentId,
        })
      )?.data;
    } catch (e: any) {
      // Some expected errors
      if (e?.message === 'Requested entity was not found.') {
        throw new NonRetryableError(`Google Document '${documentId}' does not exist`);
      }
      if (e?.message === 'The caller does not have permission') {
        throw new NonRetryableError(`Google Document '${documentId}' does not share access`);
      }

      // Something unexpected
      throw e;
    }

    if (document?.body == null) {
      throw new NonRetryableError(`Google Document '${documentId}' has no content`);
    }

    return document.body;
  }

  static async fetchGoogleDocumentContent(
    submissionLink: string | null | undefined,
  ): Promise<docs.docs_v1.Schema$Body> {
    if (submissionLink == null || !submissionLink.startsWith('https://docs.google.com/document/d/')) {
      throw new NonRetryableError(`Submission link is not valid: '${submissionLink}'`);
    }

    let documentId: string | null = null;
    try {
      const url = new URL(submissionLink);
      documentId = url.pathname.split('/')?.[3] ?? null;
    } catch (error) {
      throw new NonRetryableError(`Invalid URL format: '${submissionLink}'`);
    }

    if (documentId == null || documentId.trim().length === 0) {
      throw new NonRetryableError(`Cannot extract documentId from the submission link: '${submissionLink}'`);
    }

    try {
      return await GoogleDocs.getDocumentById(documentId);
    } catch (e) {
      // Retries will not help us if we had a problem fetching document
      throw new NonRetryableError(`Cannot fetch Google Document (${submissionLink}): ${(e as Error)?.message ?? e}`);
    }
  }

  static async exportAsText(submissionLink: string): Promise<string | null> {
    const document = await GoogleDocs.fetchGoogleDocumentContent(submissionLink);
    return ContentExtraction.extractText(document);
  }
}
