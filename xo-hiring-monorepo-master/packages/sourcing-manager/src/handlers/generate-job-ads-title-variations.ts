import { PutObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { defaultLogger, Salesforce, SalesforceIntegrationLogger } from '@trilogy-group/xoh-integration';
import {
  GeneratedOutput,
  JobTitleVariationGenerationService,
  KontentPipelineItem,
  LLMProvider,
  PromptProvider,
  VariationGenerationInput,
} from '../services/job-title-variation-generation-service';
import { DateTime } from 'luxon';

const log = defaultLogger({ serviceName: 'job-ads-title-variation-gen' });
SalesforceIntegrationLogger.setLogLevel('WARN');
const s3Client = new S3Client();
const ParallelGenerationBatchSize = 16;

// Cache for recent variations
let recentVariationsCache: Set<string> = new Set();

function getVariationsBucketName(): string {
  const bucketName = process.env.JOB_AD_VARIATION_OUTPUT_BUCKET;
  if (!bucketName) {
    throw new Error('JOB_AD_VARIATION_OUTPUT_BUCKET environment variable is not set');
  }
  return bucketName;
}

async function updateRecentVariationsCache(): Promise<void> {
  try {
    const fourHoursAgo = DateTime.now().minus({ hours: 4 });
    const allObjects: Array<{ Key: string; LastModified: Date }> = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: getVariationsBucketName(),
        Prefix: 'ad-title-variations/',
        ContinuationToken: continuationToken,
      });

      const response = await s3Client.send(command);

      if (response.Contents) {
        response.Contents.forEach((content) => {
          if (content.Key != null && content.LastModified != null) {
            allObjects.push({ Key: content.Key, LastModified: content.LastModified });
          }
        });
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    // Extract jobTitleId from the keys and filter recent ones
    recentVariationsCache = new Set(
      allObjects
        .filter((obj) => obj.LastModified > fourHoursAgo.toJSDate())
        .map((obj) => obj.Key.split('/')[1].replace('.json', ''))
        .filter((jobTitleId) => jobTitleId), // Filter out invalid entries
    );

    log.info(`Updated recent variations cache with ${recentVariationsCache.size} entries`);
  } catch (error) {
    log.error('Error updating recent variations cache', error as Error);
    recentVariationsCache = new Set(); // Reset cache on error
  }
}

function hasRecentVariation(jobTitleId: string): boolean {
  return recentVariationsCache.has(jobTitleId);
}

export async function generateJobAdsTitleVariations(onlyForTitles: string[] = []): Promise<void> {
  const bucketName = getVariationsBucketName();

  const sf = await Salesforce.getDefaultClient();

  // Update cache at the start of the Lambda
  await updateRecentVariationsCache();

  if (onlyForTitles.length > 0) {
    log.info(`Generating job ads title variations for ${onlyForTitles.length} titles only`);
  }

  log.info('Fetching active pipelines with job titles');
  const activePipelines = await JobTitleVariationGenerationService.fetchActivePipelinesWithJobTitles(sf);

  let count = 0;
  activePipelines.forEach((pipeline) => {
    log.info(`Processing pipeline: ${pipeline.Name} (${pipeline.ProductCode})`);
    if (pipeline.Pipeline_Job_Titles__r != null) {
      pipeline.Pipeline_Job_Titles__r.records.forEach((jobTitle) => {
        log.info(`  Job Title: ${jobTitle.Job_Title__c}`);
        count++;
      });
    }
  });
  const pipelineCodes = activePipelines.map((pipeline) => pipeline.ProductCode);

  log.info(`Fetched ${count} job titles across ${activePipelines.length} active pipelines`);
  log.info(`Fetching Kontent data for pipelines`);

  const kontentData = await JobTitleVariationGenerationService.fetchKontentData(pipelineCodes);
  log.info(`Fetched ${kontentData.length} Kontent items`);

  let variationGenerationInputs: VariationGenerationInput[] = [];

  activePipelines.forEach((pipeline) => {
    const relatedKontentItem = kontentData.find(
      (item) => `${item.elements.pipeline_code.value}` === `${pipeline.ProductCode}`,
    );

    if (relatedKontentItem) {
      if (pipeline.Pipeline_Job_Titles__r != null) {
        pipeline.Pipeline_Job_Titles__r.records.forEach((jobTitle) => {
          if (onlyForTitles.length > 0 && !onlyForTitles.includes(jobTitle.Id)) {
            return;
          }
          variationGenerationInputs.push({
            pipeline,
            jobTitle,
            kontentData: JSON.parse(JSON.stringify(relatedKontentItem)) as KontentPipelineItem, // Deep clone
          });
        });
      }
    } else {
      log.warn(`No Kontent item found for pipeline ${pipeline.Name} (${pipeline.ProductCode})`);
    }
  });

  log.info(`Prepared ${variationGenerationInputs.length} inputs for variation generation`);
  const llmProviders = JobTitleVariationGenerationService.getLLMProviders();
  const promptProviders = JobTitleVariationGenerationService.getPromptProviders();

  // Filter out job titles that already have recent variations
  variationGenerationInputs = variationGenerationInputs.filter((input) => !hasRecentVariation(input.jobTitle.Id));
  log.info(`Filtered to ${variationGenerationInputs.length} inputs after removing recent variations`);

  // Reshuffle the variationGenerationInputs array to avoid processing the same pipeline in a row
  shuffleArray(variationGenerationInputs);

  // Iterate over the variationGenerationInputs array in batches of ParallelGenerationBatchSize
  // Pick different (as much as possible) llm and prompt providers for each element in the batch
  // If the result is null, log and return element to the array to retry with a different llm/provider
  // If not null - save the result to S3

  while (variationGenerationInputs.length > 0) {
    const batch = variationGenerationInputs.splice(0, ParallelGenerationBatchSize);
    const batchPromises = batch.map((input, index) => {
      const llm = llmProviders[index % llmProviders.length];
      const prompt = promptProviders[index % promptProviders.length];
      return generateTitleVariation(input, llm, prompt, bucketName);
    });

    const results = await Promise.all(batchPromises);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const input = batch[i];

      if (result === null) {
        log.warn(`Failed to generate variation for job title: ${input.jobTitle.Job_Title__c}`);
        variationGenerationInputs.push(input);
      }
    }

    // Add a small delay to avoid overwhelming the LLM providers
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  log.info('Finished generating job ads title variations');
}

async function generateTitleVariation(
  input: VariationGenerationInput,
  llm: LLMProvider,
  prompt: PromptProvider,
  bucketName: string,
): Promise<KontentPipelineItem | null> {
  const variation = await llm.generateVariation(input, prompt);

  if (variation == null) {
    return null;
  }

  const updated = updateKontentItems(input.kontentData, variation);
  await saveTitleVariationToS3(bucketName, input, updated, prompt.getId(), llm.getId());

  return updated;
}

function updateKontentItems(base: KontentPipelineItem, update: GeneratedOutput): KontentPipelineItem {
  const updatedKontentItem = JSON.parse(JSON.stringify(base)) as KontentPipelineItem;
  updatedKontentItem.elements.hook.value = update.hook ?? '';
  updatedKontentItem.elements.what_you_will_be_doing.value = update.whatYouWillBeDoing ?? '';
  updatedKontentItem.elements.what_you_will_not_be_doing.value = update.whatYouWillNotBeDoing ?? '';
  updatedKontentItem.elements.responsibilities.value = update.responsibilities ?? '';
  updatedKontentItem.elements.requirements.value = update.requirements ?? '';
  updatedKontentItem.elements.nice_to_have.value = update.niceToHave ?? '';
  updatedKontentItem.elements.what_you_will_learn.value = update.whatYouWillLearn ?? '';
  updatedKontentItem.elements.work_examples.value = update.workExamples ?? '';
  updatedKontentItem.elements.primary_contribution.value = update.primaryContribution ?? '';
  return updatedKontentItem;
}

async function saveTitleVariationToS3(
  bucketName: string,
  input: VariationGenerationInput,
  item: KontentPipelineItem,
  promptId: string,
  llmId: string,
): Promise<void> {
  const key = `ad-title-variations/${input.jobTitle.Id}.json`;
  const s3Path = `s3://${bucketName}/${key}`;
  log.info(`Saving job ad variation to S3 bucket: ${s3Path} (${llmId}; ${promptId})`);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(item.elements),
      ContentType: 'application/json',
      Metadata: {
        promptId,
        llmId,
      },
    }),
  );
}

function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i >= 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}
