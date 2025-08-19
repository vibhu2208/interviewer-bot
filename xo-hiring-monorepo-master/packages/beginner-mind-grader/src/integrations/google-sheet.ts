import { sheets_v4 } from '@googleapis/sheets';
import * as gs from '@googleapis/sheets';
import { defaultLogger, SecretsManager } from '@trilogy-group/xoh-integration';
import { CredentialBody } from 'google-auth-library';
import Schema$Sheet = sheets_v4.Schema$Sheet;

const log = defaultLogger({ serviceName: 'google-sheet' });

export interface SheetData {
  title: string;
  content: any[][];
}

let sheetsClient: gs.sheets_v4.Sheets | null = null;

export async function getGoogleCredentials(): Promise<CredentialBody> {
  const secretName = process.env.GOOGLE_CREDENTIALS_SECRET_NAME;
  if (secretName == null) {
    throw new Error('Env variable GOOGLE_CREDENTIALS_SECRET_NAME is not defined');
  }
  const credentials = await SecretsManager.fetchSecretJson<CredentialBody>(secretName);
  if (credentials == null) {
    throw new Error(`Cannot fetch credentials from secret ${secretName}`);
  }
  return credentials;
}

export class BadUrlError extends Error {}

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

    return GoogleSheets.getApiClient(await getGoogleCredentials());
  }

  static extractSpreadsheetId(url: string): string {
    const matches = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!matches || matches.length < 2) {
      throw new BadUrlError(`Bad Google Sheet URL: '${url}'`);
    }
    return matches[1];
  }

  static async getSheetsByName(spreadsheetId: string, sheetNames?: string[]): Promise<SheetData[]> {
    const client = await GoogleSheets.default();

    // Get all sheets if no specific names provided
    let sheets: Schema$Sheet[] = [];
    try {
      const response = await client.spreadsheets.get({
        spreadsheetId,
        includeGridData: false,
      });
      sheets = response.data.sheets;
    } catch (e) {
      throw new Error(`Cannot fetch google sheet: ${e?.message}`);
    }

    if (sheets == null || sheets.length === 0) {
      throw new Error('No sheets found in the spreadsheet.');
    }

    const sheetsToFetch = sheetNames
      ? sheets.filter((sheet) => sheetNames.includes(sheet.properties?.title || ''))
      : sheets;

    if (sheetNames && sheetsToFetch.length !== sheetNames.length) {
      const missingSheets = sheetNames.filter((name) => !sheets.find((sheet) => sheet.properties?.title === name));
      log.warn(`Some requested sheets were not found: ${missingSheets.join(', ')}`);
    }

    const extractedSheets = sheetsToFetch.map(async (sheet) => {
      const title = sheet.properties?.title || '';
      const response = await client.spreadsheets.values.get({
        spreadsheetId,
        range: title,
      });

      return {
        title,
        content: response.data.values || [],
      };
    });

    return Promise.all(extractedSheets);
  }
}
