import { LanguageVariantContracts, LanguageVariantElementsBuilder, ManagementClient } from '@kontent-ai/management-sdk';
import { AxiosResponse } from 'axios';
import { DeliveryClient, IContentItem } from '@kontent-ai/delivery-sdk';
import { signatureHelper, WebhookResponse } from '@kontent-ai/webhook-helper';
import { getSalesforceClient } from '@trilogy-group/xo-hiring-integration';
import { generateObject } from 'ai';
import { Llm } from '@trilogy-group/xoh-integration';
import { logger } from '../logger';
import { SSMConfig } from '../ssm-config';
import { SalesforceRest } from '../urls';
import { APIGatewayProxyEvent } from 'aws-lambda';
import {
  axiosErrorResponse,
  successResponse,
  updateContentItem,
  changeWorkflowStep,
  DEFAULT_LANGUAGE,
} from '../cms-helpers';
import { z } from 'zod';

let workLocation = '';
let weeklyHours = '';

interface SalesforceResponse {
  totalSize: number;
  done: boolean;
  records: {
    Id: string;
    Name: string;
    Family: string;
    ProductCode: string;
    Hours_per_Week__c: number;
    Job_Type__c: string;
    Geographic_Restriction__c: string;
    Work_Country__c?: string | null;
    Work_Locations__r?: {
      totalSize: number;
      done: boolean;
      records: {
        Location__r: {
          Name_in_Recruiter__c: string;
        };
      }[];
    } | null;
  }[];
}

const LLMResponseSchema = z.object({
  Remote_policy: z.string().describe('Work location policy: "in_person", "hybrid_location", or "fully_remote"'),
  Schedule: z.object({
    Value: z.string().describe('Work schedule type: "Semi-flexible schedule", "Flexible schedule", or specific hours'),
    Description: z.string().nullable().describe('Reference to work timings from JD when semi-flexible'),
  }),
  Duration: z.object({
    Value: z.string().describe('Contract duration: "short_term_contract" or "long_term_role"'),
    Description: z.string().nullable().describe('Contract duration details when short-term'),
  }),
});
type LLMResponseSchemaType = z.infer<typeof LLMResponseSchema>;

/**
 * Handles metadata and content enhancement using LLM for a given payload.
 */
export async function handlePipelineMetadata(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
  const config = await SSMConfig.getForEnvironment();

  if (!isValidSignature(event, config.kontentWebhookSecret) || event.body == null) {
    return axiosErrorResponse(`Invalid webhook signature or notification`, 400, 'Bad Request');
  }

  const payload = JSON.parse(event.body);
  const itemId = payload?.notifications?.[0]?.data?.system?.id;
  const contentType = payload?.notifications?.[0]?.data?.system?.type;
  const workflowStep = payload?.notifications?.[0]?.data?.system?.workflow_step;
  if (itemId == null || workflowStep !== 'compliance_review' || contentType !== 'pipeline') {
    return axiosErrorResponse('No ID found in payload or incorrect workflow step', 400, 'Bad Request');
  }

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

  if (contentItem == null) {
    return axiosErrorResponse(`No content found for ID: ${itemId}`, 404, 'Not Found');
  }

  if (contentItem.elements?.pipeline_code?.value) {
    await getSFWorkPlaceAndHours(contentItem.elements?.pipeline_code?.value);
  }

  const prompt = generateGPTPrompt(contentItem);
  const model = await Llm.getDefaultModel();
  let llmResponse: LLMResponseSchemaType | null = null;

  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    attempts++;
    try {
      const { object } = await generateObject({
        model,
        prompt,
        temperature: 0.7,
        schema: LLMResponseSchema,
      });
      llmResponse = object;
      break;
    } catch (error) {
      logger.error(`Attempt ${attempts}: Failed to get structured response from LLM`, error as Error);
      if (attempts >= maxAttempts) {
        return axiosErrorResponse('Failed to get structured response from LLM', 500, 'Internal Server Error');
      }
    }
  }

  if (llmResponse == null) {
    return axiosErrorResponse('Failed to get valid response from LLM', 500, 'Internal Server Error');
  }

  const dataBuilder = await buildData(llmResponse);

  const updateSuccessful = await updateContentItem(managementClient, itemId, dataBuilder);
  if (!updateSuccessful) {
    return axiosErrorResponse('Failed to update content item', 500, 'Internal Server Error');
  }

  await changeWorkflowStep(managementClient, itemId);

  return successResponse('Content updated and published successfully');
}

/**
 * Validates the signature of the incoming webhook event.
 */
function isValidSignature(event: APIGatewayProxyEvent, secret: string): boolean {
  const body = event.body as string;
  const signature = event.headers['X-Kontent-ai-Signature'] as string;
  // Parse and re-stringify the body to ensure proper formatting
  const parsedBody = JSON.parse(body) as WebhookResponse;
  const formattedPayload = JSON.stringify(parsedBody, null, 2);
  // Normalize line breaks in the formatted payload
  const payload = signatureHelper.replaceLinebreaks(formattedPayload);

  return signatureHelper.isValidSignatureFromString(payload, secret, signature);
}

/**
 * Fetches the content item from Kontent.ai Delivery API.
 */
async function fetchContentItem(deliveryClient: DeliveryClient, itemId: string) {
  return await deliveryClient
    .items()
    .type('pipeline')
    .equalsFilter('system.id', itemId)
    .elementsParameter([
      'pipeline_code',
      'brand',
      'name',
      'functional_domain',
      'primary_contribution',
      'hook',
      'what_you_will_be_doing',
      'what_you_will_not_be_doing',
      'responsibilities',
      'requirements',
      'nice_to_have',
      'what_you_will_learn',
      'work_examples',
    ])
    .languageParameter(DEFAULT_LANGUAGE)
    .toPromise();
}

/**
 * Processes the pipeline code to retrieve additional details.
 */
async function getSFWorkPlaceAndHours(pipelineCode: string) {
  const queryStr = `SELECT Id, Name, Family, ProductCode, Hourly_Rate__c, Hours_per_Week__c, Monthly_Rate__c, Yearly_Rate__c,
        Type__c, Job_Type__c, Status__c, (SELECT Id, Name, Location__r.Id, Location__r.Name, Location__r.Country__c,
        Location__r.Name_in_Recruiter__c, Location__r.LI_Posting_Name__c FROM Work_Locations__r),
        Sourcing_Geographic_Restriction__c, Work_Country__c, Geographic_Restriction__c
        FROM Product2
        WHERE ProductCode='${pipelineCode}'
        LIMIT 1`;

  const getSFPipeline = await sfQuery(queryStr);
  if (getSFPipeline) {
    workLocation = await getWorkPlace(getSFPipeline);
    weeklyHours = await getJobTypeAndHours(getSFPipeline);
  }
}

/**
 * Generates the GPT prompt based on the content item.
 */
function generateGPTPrompt(contentItem: IContentItem): string {
  return `
    You are a Recruitment Professional specializing in the recruitment of professionals who work remotely, 
    and hence you have a thorough knowledge of the terminology and practices applicable to remote working. 
    Please understand the job description appended below and then populate the following JSON format 
    with the details required for this job.
    {
      "Remote_policy": // Mention "in_person" if specific location or In-person stated in the JD, Mention "hybrid_location" if Hybrid stated in the JD, else mention "fully_remote"
      "Schedule": {
        "Value": // Mention “Semi-flexible schedule” if there is reference to work timings or schedule in the JD, else mention “Hours: “ followed by the exact work timings in the Format “hh:mm a.m./p.m. to hh:mm a.m./p.m. ZZZZ”, only if the exact (and not vague) timings or if there is specific work location, typically not exceeding 9 hours a day, are available in the JD, where “ZZZZ” is the three or four letter abbreviation used for the time zone, else mention “Flexible schedule”
        "Description": // Every time the Schedule above is set to "Semi-flexible schedule", mention the complete sentence from the JD (within quotes) where there is a reference to work timings, else set to null
      },
      "Duration": {
        "Value": // Mention "short_term_contract" if there is any reference to contract duration (in terms of months or years) in the JD, else mention "long_term_role"
        "Description": // If the Duration above is set to "short_term_contract", mention the complete sentence from the JD (within quotes) where there is a reference to contract duration, else set to null
      }
    }
    Please strictly adhere to all conditions set above. Please use US English.

    Brand: ${contentItem.elements?.brand?.value}
    Role: ${contentItem.system?.name}
    Functional Division: ${contentItem.elements?.functional_domain?.value[0]?.name}
    Primary Contribution: ${contentItem.elements?.primary_contribution?.value}
    Job Description: ${contentItem.elements?.hook?.value}
    What you will be doing: ${contentItem.elements?.what_you_will_be_doing?.value}
    What you will NOT be doing: ${contentItem.elements?.what_you_will_not_be_doing?.value}
    Key Responsibilities: ${contentItem.elements?.responsibilities?.value}
    Candidate Requirements: ${contentItem.elements?.requirements?.value}
    Nice to have: ${contentItem.elements?.nice_to_have?.value}
    What you will learn: ${contentItem.elements?.what_you_will_learn?.value}
    Work Examples: ${contentItem.elements?.work_examples?.value}`;
}

/**
 * Builds the data to update the content item.
 */
function buildData(LLMParsedResponse: LLMResponseSchemaType) {
  return (builder: LanguageVariantElementsBuilder): LanguageVariantContracts.IUpsertLanguageVariantPostContract => ({
    elements: [
      builder.multipleChoiceElement({
        element: { codename: 'remote_policy' },
        value: [{ codename: LLMParsedResponse.Remote_policy }],
      }),
      builder.textElement({
        element: { codename: 'schedule' },
        value: LLMParsedResponse.Schedule.Value,
      }),
      builder.textElement({
        element: { codename: 'schedule_description' },
        value: LLMParsedResponse.Schedule.Description,
      }),
      builder.multipleChoiceElement({
        element: { codename: 'duration' },
        value: [{ codename: LLMParsedResponse.Duration.Value }],
      }),
      builder.textElement({
        element: { codename: 'duration_description' },
        value: LLMParsedResponse.Duration.Description,
      }),
      builder.textElement({
        element: { codename: 'work_location' },
        value: workLocation,
      }),
      builder.textElement({
        element: { codename: 'weekly_hours' },
        value: weeklyHours,
      }),
    ],
  });
}

/**
 * get eligible work location for pipeline
 */
function getWorkPlace(pipeline: SalesforceResponse): string {
  const pipelineRecord = pipeline?.records[0];
  switch (pipelineRecord?.Geographic_Restriction__c) {
    case 'Country':
      return pipelineRecord?.Geographic_Restriction__c;
    case 'City':
      return getWorkLocations(pipelineRecord);
    default:
      return 'Any country';
  }
}

/**
 * Get list of eligible work cities for pipeline
 */
function getWorkLocations(pipelineRecord: SalesforceResponse['records'][0]): string {
  const workLocations = pipelineRecord.Work_Locations__r;

  if (workLocations && workLocations.records.length > 0) {
    const workLocationArray = workLocations.records.map((record) => record.Location__r.Name_in_Recruiter__c);

    if (workLocationArray.length === 1) {
      return `${workLocationArray[0]}, ${pipelineRecord.Work_Country__c || 'Country not specified'}`;
    }

    if (workLocationArray.length > 1) {
      return `${workLocationArray.slice(0, -1).join(', ')} or ${workLocationArray.slice(-1)}, ${
        pipelineRecord.Work_Country__c || 'Country not specified'
      }`;
    }

    return '';
  }

  return '';
}

function getJobTypeAndHours(pipeline: SalesforceResponse): string {
  const pipelineRecord = pipeline.records[0];
  const jobType = pipelineRecord.Job_Type__c;
  const hoursPerWeek = pipelineRecord.Hours_per_Week__c;

  return `${capitalizeFirstLetter(jobType)} (${hoursPerWeek} hrs/week)`;
}

function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

async function sfQuery(q: string) {
  try {
    const client = await getSalesforceClient();
    const response = await client.get(SalesforceRest.query, {
      params: { q },
    });
    return response.data; // Ensure you return the data from the response
  } catch (error) {
    return axiosErrorResponse(`Failed to query pipeline on CRM`, 404, 'Not Found');
  }
}
