import { Salesforce } from '@trilogy-group/xoh-integration';
import { FeedUploadService } from '../services/feed-upload-service';
import {
  getActivePipelinesWithWorkLocations,
  getCountryNameToCodeMap,
  getJobAdXCampaigns,
} from '../services/jobadx-data-service';
import { buildJobAdXXmlFeed } from '../services/jobadx-feed-builder';

/**
 * Retrieves data from Salesforce and builds a JobAdX XML feed file.
 */
export async function handler() {
  await generateJobAdXXmlFeed();
}

export async function generateJobAdXXmlFeed() {
  const client = await Salesforce.getAdminClient();
  const campaigns = await getJobAdXCampaigns(client);
  const countryNameToCodeMap = await getCountryNameToCodeMap(client);
  const activePipelinesWithWorkLocations = await getActivePipelinesWithWorkLocations(client);
  const xmlFeed = buildJobAdXXmlFeed(campaigns, activePipelinesWithWorkLocations, countryNameToCodeMap);

  await FeedUploadService.uploadXMLToS3Bucket('jobadx/jobadx-jobs-feed.xml', xmlFeed);
}
