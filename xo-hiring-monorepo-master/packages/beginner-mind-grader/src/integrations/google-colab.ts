import * as drive from '@googleapis/drive';
import { CredentialBody } from 'google-auth-library';
import { BadUrlError, getGoogleCredentials } from './google-sheet';

type DriveClient = drive.drive_v3.Drive;
let driveClient: DriveClient;

export type GoogleColabNotebook = {
  cells: GoogleColabCell[];
  metadata?: unknown;
};

export type GoogleColabCell = {
  cell_type: string;
  execution_count?: number;
  metadata?: unknown;
  outputs?: unknown[];
  source?: string[];
  text?: string;
};

/**
 * Google Colab integration
 * */
export class GoogleColab {
  /**
   * Returns (and caches) a Google Drive API client
   */
  static async getApiClient(credentials: CredentialBody): Promise<DriveClient> {
    if (driveClient == null) {
      const auth = new drive.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      });

      driveClient = drive.drive({ version: 'v3', auth });
    }

    return driveClient;
  }

  static async default(): Promise<DriveClient> {
    if (driveClient != null) {
      return driveClient;
    }

    return GoogleColab.getApiClient(await getGoogleCredentials());
  }

  /**
   * Exports a Colab notebook as a json
   */
  static async exportAsJsonString(driveLink: string): Promise<string> {
    const documentId = getFileIdFromUrl(driveLink);

    try {
      const client = await GoogleColab.default();
      const response = await client.files.get({ fileId: documentId, alt: 'media' }, { responseType: 'stream' });

      const result = await new Promise<string>((resolve, reject) => {
        let data = '';
        response.data.on('data', (chunk) => {
          data += chunk;
        });
        response.data.on('end', () => {
          resolve(data);
        });
        response.data.on('error', (err) => {
          reject(err);
        });
      });

      try {
        return prettifyColabJson(result);
      } catch (e) {
        // Not a valid JSON
        return result;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // Some expected errors
      if (e?.message === 'Requested entity was not found.') {
        throw new Error(`Google Drive Document '${documentId}' does not exist`);
      }
      if (e?.message === 'The caller does not have permission') {
        throw new Error(`Google Drive Document '${documentId}' does not share access`);
      }

      let jsonError = null;
      try {
        jsonError = JSON.parse(e.message);
      } catch (e) {
        // Ignored
      }

      if (jsonError?.error?.message) {
        throw new Error(jsonError?.error?.message);
      }

      throw e;
    }
  }

  static async exportAsMarkdownOrJson(driveLink: string): Promise<string> {
    const content = await GoogleColab.exportAsJsonString(driveLink);
    try {
      const rawContent = JSON.parse(content);
      let markdown = '';
      rawContent.cells.forEach((cell: any) => {
        if (cell.cell_type === 'markdown') {
          markdown += removeCommas(cell.text) + '\n\n';
        } else if (cell.cell_type === 'code') {
          markdown += '```python\n' + removeCommas(cell.text) + '\n```\n\n';
        }
      });
      return markdown;
    } catch (e) {
      return content;
    }
  }
}

/**
 * If the line starts from ',' remove the first symbol
 * @param input
 */
function removeCommas(input: string): string {
  const lines: string[] = input?.split('\n');
  lines.forEach((line, index) => {
    if (line.startsWith(',')) {
      lines[index] = line.slice(1);
    }
  });
  return lines.join('\n');
}

/**
 * Pretty prints a Google Colab JSON notebook.
 */
function prettifyColabJson(result: string) {
  const notebook = JSON.parse(result) as GoogleColabNotebook;

  // Clean up the notebook
  for (const cell of notebook.cells) {
    cell.text = cell.source?.join();

    delete cell.outputs;
    delete cell.execution_count;
    delete cell.metadata;
    delete cell.source;
  }

  notebook.cells = notebook.cells.filter((cell) => cell.text);
  delete notebook.metadata;

  return JSON.stringify(notebook, null, 2);
}

/**
 * Extracts the file ID from a Google Drive URL.
 * @param link The Google Drive URL.
 * @returns The file ID.
 */
export function getFileIdFromUrl(link: string): string {
  let parts: string[] = [];

  try {
    const url = new URL(link);
    if (link.includes('/file/d/')) {
      parts = url.pathname.split('/file/d/');
    } else if (link.includes('/notebook/d/')) {
      parts = url.pathname.split('/notebook/d/');
    } else if (link.includes('/drive/')) {
      parts = url.pathname.split('/drive/');
    }
  } catch (e) {
    throw new BadUrlError(`Bad Jupyter URL: '${link}'`);
  }

  let documentId: string | null = null;
  if (parts.length > 1) {
    documentId = parts[1].split('?')[0]?.split('/')?.[0];
  }

  if (documentId == null || documentId.trim().length === 0) {
    throw new BadUrlError(`Cannot extract documentId from the link: '${link}'`);
  }

  return documentId;
}
