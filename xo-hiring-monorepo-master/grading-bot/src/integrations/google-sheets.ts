import * as gs from '@googleapis/sheets';
import { CredentialBody } from 'google-auth-library';
import { NonRetryableError } from '../common/non-retryable-error';

import { Config } from '../config';
import { Secrets } from './secrets';
import { Logger } from '../common/logger';

let sheetsClient: gs.sheets_v4.Sheets;

const log = Logger.create('GoogleSheets');

export class GoogleSheets {
  static async getApiClient(credentials: CredentialBody): Promise<gs.sheets_v4.Sheets> {
    if (sheetsClient == null) {
      const auth = new gs.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });

      sheetsClient = gs.sheets({ version: 'v4', auth });
    }

    return sheetsClient;
  }

  static async default(): Promise<gs.sheets_v4.Sheets> {
    if (sheetsClient != null) {
      return sheetsClient;
    }

    const credentials = await Secrets.fetchJsonSecret<CredentialBody>(Config.getGoogleCredentialsSecretName());
    return GoogleSheets.getApiClient(credentials);
  }

  static async export(url: string): Promise<{ title: string; content: string }[]> {
    try {
      const spreadsheetId = GoogleSheets.extractSpreadsheetId(url);
      const client = await GoogleSheets.default();

      const response = await client.spreadsheets.get({
        spreadsheetId,
        includeGridData: false,
      });

      const sheets = response.data.sheets;
      if (!sheets) {
        throw new NonRetryableError('No sheets found in the spreadsheet.');
      }

      const extractedSheets = sheets.map(async (sheet) => {
        const title = sheet.properties?.title || '';
        const response = await client.spreadsheets.values.get({
          spreadsheetId,
          range: title,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) {
          return { title, content: '' };
        }

        const content = rows.map((row: string[]) => row.map((cell) => escapeCsvCell(cell)).join(',')).join('\n');

        return { title, content };
      });

      const extractedSheetsContent = await Promise.all(extractedSheets);
      return extractedSheetsContent?.filter((sheet) => sheet.content.length > 0) || [];
    } catch (e) {
      log.error('Error while exporting Google Sheets', e);
      throw new NonRetryableError(`Failed to export Google Sheets content: ${e}`);
    }
  }

  static async exportAsMarkdown(url: string): Promise<string> {
    const sheets = await GoogleSheets.export(url);
    return sheets.map((sheet) => `===\nSheet: ${sheet.title}\nContent:\n${sheet.content}\n===`).join('\n\n');
  }

  static canBeGoogleSheet(url: string): boolean {
    return url.includes('docs.google.com/spreadsheets');
  }

  static extractSpreadsheetId(submissionLink: string): string {
    if (submissionLink == null || !submissionLink.startsWith('https://docs.google.com/spreadsheets/d/')) {
      throw new NonRetryableError(`Submission link is not valid: '${submissionLink}'`);
    }

    let documentId: string | null = null;
    try {
      const url = new URL(submissionLink);
      documentId = url.pathname.split('/')?.[3] ?? null;
    } catch (e) {
      throw new NonRetryableError(`Cannot fetch Google Sheet (${submissionLink}): ${(e as Error)?.message ?? e}`);
    }
    if (documentId == null || documentId.trim().length === 0) {
      throw new NonRetryableError(`Cannot extract documentId from the submission link: '${submissionLink}'`);
    }
    return documentId;
  }
}

function escapeCsvCell(cell: string): string {
  return `"${cell.replace(/"/g, '""')}"`;
}
