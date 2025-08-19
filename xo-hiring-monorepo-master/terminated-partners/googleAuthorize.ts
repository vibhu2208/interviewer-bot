import { google } from 'googleapis';
import { CredentialBody } from 'google-auth-library';

/**
 * Request access token from Google
 * @param googleAccessConfig
 * @returns Google access token
 */
export async function getGoogleAccessToken(googleAccessConfig: CredentialBody) {
  const auth = new google.auth.GoogleAuth({
    credentials: googleAccessConfig,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/script.external_request',
    ],
  });
  return auth.getAccessToken();
}
