import { LanguageVariantContracts, LanguageVariantElementsBuilder, ManagementClient } from '@kontent-ai/management-sdk';
import { AxiosRequestHeaders, AxiosResponse } from 'axios';
import { logger } from './logger';

export const DEFAULT_LANGUAGE = 'default';

/**
 * Helper function to generate consistent Axios error responses.
 */
export function axiosErrorResponse(message: string, status: number, statusText: string): AxiosResponse {
  return {
    data: { error: message },
    status: status,
    statusText: statusText,
    headers: {},
    config: {
      headers: {} as AxiosRequestHeaders,
    },
  };
}

/**
 * Helper function to generate a success response.
 */
export function successResponse(message: string): AxiosResponse {
  return {
    data: { message: message },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {
      headers: {} as AxiosRequestHeaders,
    },
  };
}

/**
 * Updates the content item, ensuring a draft version if needed.
 */
export async function updateContentItem(
  managementClient: ManagementClient,
  itemId: string,
  dataBuilder: (builder: LanguageVariantElementsBuilder) => LanguageVariantContracts.IUpsertLanguageVariantPostContract,
): Promise<boolean> {
  try {
    await upsertLanguageVariant(managementClient, itemId, dataBuilder);
  } catch (error) {
    logger.error('Initial upsert failed:', error as Error);
    await ensureDraftVersion(managementClient, itemId);
    try {
      await upsertLanguageVariant(managementClient, itemId, dataBuilder);
    } catch (error) {
      logger.error('Upsert failed after ensuring draft version:', error as Error);
      return false;
    }
  }
  return true;
}

async function upsertLanguageVariant(
  managementClient: ManagementClient,
  itemId: string,
  dataBuilder: (builder: LanguageVariantElementsBuilder) => LanguageVariantContracts.IUpsertLanguageVariantPostContract,
): Promise<void> {
  await managementClient
    .upsertLanguageVariant()
    .byItemId(itemId)
    .byLanguageCodename(DEFAULT_LANGUAGE)
    .withData(dataBuilder)
    .toPromise();
}

/**
 * Ensures there's a draft version of the content item available.
 */
async function ensureDraftVersion(managementClient: ManagementClient, itemId: string) {
  try {
    await managementClient
      .createNewVersionOfLanguageVariant()
      .byItemId(itemId)
      .byLanguageCodename(DEFAULT_LANGUAGE)
      .toPromise();
  } catch (error) {
    logger.error('Error creating a new draft version:', error as Error);
  }
}

/**
 * Changes the workflow step of the content item.
 */
export async function changeWorkflowStep(managementClient: ManagementClient, itemId: string) {
  await managementClient
    .changeWorkflowOfLanguageVariant()
    .byItemId(itemId)
    .byLanguageCodename(DEFAULT_LANGUAGE)
    .withData({
      step_identifier: {
        codename: 'compliance_review',
      },
      workflow_identifier: {
        codename: 'default',
      },
    })
    .toPromise();
}

/**
 * Publishes the Content item.
 */
export async function publishContentItem(managementClient: ManagementClient, itemId: string) {
  try {
    await managementClient
      .publishLanguageVariant()
      .byItemId(itemId)
      .byLanguageCodename(DEFAULT_LANGUAGE)
      .withoutData()
      .toPromise();
  } catch (error) {
    logger.error('Error publishing the content item:', error as Error);
  }
}
