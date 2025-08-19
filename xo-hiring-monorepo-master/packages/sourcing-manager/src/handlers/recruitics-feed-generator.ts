import { Salesforce } from '@trilogy-group/xoh-integration';
import { EventPayload, getCampaigns, getConfig, getCountries } from '../services/recruitics-data-service';
import { buildJobFeedXml } from '../services/recruitics-feed-builder';
import { FeedUploadService } from '../services/feed-upload-service';

/**
 * Retrieves data from Salesforce and builds a Recruitics job feed XML file.
 * @param event Lambda event containing values that allows to specify configuration parameters.
 */
export const handler = async (event: EventPayload = {}) => {
  const config = await getConfig(event);

  console.log('Loading data from salesforce...');
  const sf = await Salesforce.getAdminClient();
  const countries = await getCountries(sf);
  const campaigns = await getCampaigns(sf);
  console.log(`Loaded ${countries.length} countries and ${campaigns.length} campaigns`);

  console.log('Building XML from the loaded job posts');
  const feed = buildJobFeedXml(campaigns, countries, config);

  await FeedUploadService.uploadXMLToS3Bucket('recruitics/recruitics-jobs-feed.xml', feed);
};
