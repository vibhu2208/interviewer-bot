import { LanguageVariantContracts, LanguageVariantElementsBuilder, ManagementClient } from '@kontent-ai/management-sdk';
import { AxiosResponse } from 'axios';
import { DeliveryClient } from '@kontent-ai/delivery-sdk';
import { logger } from '../logger';
import { SSMConfig } from '../ssm-config';
import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  axiosErrorResponse,
  successResponse,
  updateContentItem,
  changeWorkflowStep,
  publishContentItem,
  DEFAULT_LANGUAGE,
} from '../cms-helpers';

/**
 * Handles FAQ item helpfulness count update
 */
export async function handleFAQHelpfulness(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
  if (event.body == null) {
    return axiosErrorResponse(`Invalid request body`, 400, 'Bad Request');
  }

  let payload: { id: string; votes: number };

  try {
    payload = JSON.parse(event.body);
  } catch (error) {
    return axiosErrorResponse(`Error parsing event body ${error}`, 400, 'Bad Request');
  }

  if (payload.id == null || (payload.votes !== 1 && payload.votes !== -1)) {
    return axiosErrorResponse(`Invalid request body`, 400, 'Bad Request');
  }

  const itemId = payload.id;
  const faqVotes = payload.votes;

  const config = await SSMConfig.getForEnvironment();
  const managementClient = new ManagementClient({
    environmentId: config.kontentProjectId,
    apiKey: config.kontentManagementApiKey,
  });
  const deliveryClient = new DeliveryClient({
    environmentId: config.kontentProjectId,
    previewApiKey: config.kontentPreviewApiKey,
    defaultQueryConfig: {
      usePreviewMode: true,
    },
  });

  const itemResponse = await fetchContentItem(deliveryClient, itemId);
  const contentItem = itemResponse.data.items[0];

  if (contentItem == null || contentItem?.system?.type !== 'faq') {
    return axiosErrorResponse(`No content found for ID: ${itemId}`, 404, 'Not Found');
  }

  const helpfulnessVotes = {
    upvotes: contentItem.elements?.upvotes?.value || 0,
    downvotes: contentItem.elements?.downvotes?.value || 0,
  };

  if (faqVotes === 1) {
    helpfulnessVotes.upvotes += 1;
  } else if (faqVotes === -1) {
    helpfulnessVotes.downvotes += 1;
  }

  const dataBuilder = buildData(helpfulnessVotes);

  const updateSuccessful = await updateContentItem(managementClient, itemId, dataBuilder);
  if (!updateSuccessful) {
    return axiosErrorResponse('Failed to update content item', 500, 'Internal Server Error');
  }

  await changeWorkflowStep(managementClient, itemId);

  if (contentItem?.system?.workflowStep === 'published') {
    await publishContentItem(managementClient, itemId);
  }

  return successResponse('FAQ Item helpfullness updated');
}

/**
 * Fetches the content item from Kontent.ai Delivery API.
 */
async function fetchContentItem(deliveryClient: DeliveryClient, itemId: string) {
  try {
    return await deliveryClient
      .items()
      .type('faq')
      .equalsFilter('system.id', itemId)
      .elementsParameter(['upvotes', 'downvotes'])
      .languageParameter(DEFAULT_LANGUAGE)
      .toPromise();
  } catch (error) {
    logger.error(`Error fetching content item with ID ${itemId}:`, error as Error);
    return axiosErrorResponse(`Error fetching content item with ID ${itemId}`, 404, 'Not Found');
  }
}

/**
 * Builds the data to update the content item.
 */
function buildData(votes: { upvotes: number; downvotes: number }) {
  return (builder: LanguageVariantElementsBuilder): LanguageVariantContracts.IUpsertLanguageVariantPostContract => ({
    elements: [
      builder.numberElement({
        element: { codename: 'upvotes' },
        value: votes.upvotes,
      }),
      builder.numberElement({
        element: { codename: 'downvotes' },
        value: votes.downvotes,
      }),
    ],
  });
}
