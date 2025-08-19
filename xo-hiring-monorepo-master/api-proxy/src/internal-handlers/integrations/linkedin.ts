import axios from 'axios';
import qs from 'querystring';
import { logger } from '../../logger';
import { Secrets } from './secrets';

export type LinkedInConfiguration = {
  client_id: string;
  client_secret: string;
  grant_type: string;
  api_url: string;
  auth_url: string;
};

export async function readResumeFileFromLinkedIn(resumeId: string): Promise<Buffer | null> {
  if (!process.env.LINKEDIN_SECRET_NAME) {
    throw new Error('LinkedIn secret name is not set');
  }

  const config: LinkedInConfiguration = await Secrets.fetchJsonSecret(process.env.LINKEDIN_SECRET_NAME);
  const accessToken = await getAccessToken(config);
  const url = `${config.api_url}/media/upload?media_type=applicant_resume&id=${resumeId}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      responseType: 'arraybuffer',
    });

    return response.data;
  } catch (error) {
    logger.error(`Failed to read resume file from LinkedIn`, error as Error);
    return null;
  }
}

async function getAccessToken(linkedInConfig: LinkedInConfiguration): Promise<string> {
  const config = {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };

  try {
    const request = {
      client_id: linkedInConfig.client_id,
      client_secret: linkedInConfig.client_secret,
      grant_type: linkedInConfig.grant_type,
    };

    const response = await axios.post(linkedInConfig.auth_url, qs.stringify(request), config);
    return response.data.access_token;
  } catch (error) {
    logger.error(`Failed to get access token`, error as Error);
    return '';
  }
}
