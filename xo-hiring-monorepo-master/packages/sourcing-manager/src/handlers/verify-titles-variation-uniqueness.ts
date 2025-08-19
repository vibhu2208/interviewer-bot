import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { defaultLogger, Salesforce, SalesforceIntegrationLogger } from '@trilogy-group/xoh-integration';
import { stringify } from 'csv-stringify/sync';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import * as fs from 'node:fs';
import {
  JobTitleVariationGenerationService,
  KontentPipelineItem,
  Pipeline,
  PipelineJobTitle,
} from '../services/job-title-variation-generation-service';

const log = defaultLogger({ serviceName: 'job-ads-title-variation-verifier' });
SalesforceIntegrationLogger.setLogLevel('WARN');
const s3Client = new S3Client();

/**
 * Not a handler yet, but can be converted to one
 */
export async function verifyTitlesVariationUniqueness(): Promise<void> {
  const bucketName = process.env.JOB_AD_VARIATION_OUTPUT_BUCKET;
  if (bucketName == null) {
    throw new Error('JOB_AD_VARIATION_OUTPUT_BUCKET env variable is required because bucket name is not defined');
  }

  const sf = await Salesforce.getDefaultClient();

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

  const embeddings = new OpenAIEmbeddings({
    model: `text-embedding-3-large`,
  });

  // Data for CSV export
  const titlesDocuments = [];
  const similarityMatrix = [];

  for (const pipeline of activePipelines) {
    const relatedKontentItem = kontentData.find(
      (item) => `${item.elements.pipeline_code.value}` === `${pipeline.ProductCode}`,
    );

    if (!relatedKontentItem) {
      continue;
    }

    if (pipeline.Pipeline_Job_Titles__r == null) {
      continue;
    }

    const pipelineContent: EmbedDocument[] = [];
    // Do not include original content, since we're not posting it
    // pipelineContent.push(await createEmbeddings(embeddings, relatedKontentItem, pipeline));

    for (const title of pipeline.Pipeline_Job_Titles__r.records) {
      const key = `ad-title-variations/${title.Id}.json`;
      const response = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
      );

      const content = (await response.Body?.transformToString()) ?? null;
      if (content == null) {
        continue;
      }
      const titleKontentItem = { elements: JSON.parse(content) } as KontentPipelineItem;
      try {
        const llmId = response.Metadata?.llmid ?? null;
        const promptId = response.Metadata?.promptid ?? null;
        pipelineContent.push(await createEmbeddings(embeddings, titleKontentItem, pipeline, title, llmId, promptId));
      } catch (e) {
        log.error(`Error processing title: ${title.Job_Title__c} (${title.Id})`, e as Error);
      }
    }

    const vectorStore = await MemoryVectorStore.fromDocuments([], embeddings);
    for (const variation of pipelineContent) {
      await vectorStore.addVectors([variation.vector], [variation.document]);
      titlesDocuments.push({
        productCode: variation.document.metadata.pipeline_code,
        titleId: variation.document.metadata.titleId,
        llmId: variation.document.metadata.llmId,
        promptId: variation.document.metadata.promptId,
        content: variation.document.pageContent,
      });
    }

    // Do a cross search
    let minScore = 1;
    let maxScore = 0;
    let sumScore = 0;
    let count = 0;
    const processed = new Set<string>();
    for (const variation of pipelineContent) {
      const result = await vectorStore.similaritySearchVectorWithScore(variation.vector, pipelineContent.length);
      for (const [document, score] of result) {
        if (document.id === variation.document.id) {
          continue; // Do not compare with itself
        }
        const parts = [variation.document.id, document.id];
        parts.sort();
        const key = parts.join('_');
        if (processed.has(key)) {
          continue;
        }
        processed.add(key);

        if (score > 0.99) {
          log.warn(
            `[${pipeline.ProductCode}] ${pipeline.Name} :: ${variation.document.metadata.title} (${
              variation.document.metadata.titleId
            }; ${variation.document.metadata.llmId}; ${
              variation.document.metadata.promptId
            }) has a high similarity score with ${document.metadata.title} (${document.metadata.titleId}; ${
              document.metadata.llmId
            }; ${document.metadata.promptId}) :: ${toPercentage(score)}`,
          );
        }

        minScore = Math.min(minScore, score);
        maxScore = Math.max(maxScore, score);
        sumScore += score;
        count++;

        trackTestData(variation.document.id!, document.id!, {
          score,
        });
      }
    }
    const avgScore = sumScore / count;
    log.info(
      `[${pipeline.ProductCode}] ${pipeline.Name} (${pipelineContent.length} titles) Difference :: Min: ${toPercentage(
        minScore,
      )}, Max: ${toPercentage(maxScore)}, Avg: ${toPercentage(avgScore)}`,
    );
  }

  const titlesData = stringify(titlesDocuments, { header: true });
  fs.writeFileSync('./titles_data.csv', titlesData, { encoding: 'utf-8' });

  // Generate similarity matrix
  const rows = Object.keys(TestData);
  for (const row of rows) {
    const data = TestData[row];
    const csvRow: any = {
      Title: row,
    };
    for (const col of rows) {
      const value = data[col];
      csvRow[col] = value?.score ?? '';
    }
    similarityMatrix.push(csvRow);
  }

  const similarityData = stringify(similarityMatrix, { header: true });
  fs.writeFileSync('./similarity_matrix.csv', similarityData, { encoding: 'utf-8' });
}

function toPercentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const TestData: Record<string, Record<string, TestDataMeasurment>> = {};

interface TestDataMeasurment {
  score: number;
}

function trackTestData(title1: string, titles2: string, results: TestDataMeasurment): void {
  const titles = [title1, titles2];
  titles.sort(); // Maintain the order to make sure we do not duplicate data
  let row = TestData[titles[0]];
  if (row == null) {
    row = {};
    TestData[titles[0]] = row;
  }
  row[titles[1]] = results;
}

interface EmbedDocument {
  document: Document;
  vector: number[];
}

async function createEmbeddings(
  embeddings: OpenAIEmbeddings,
  item: KontentPipelineItem,
  pipeline: Pipeline,
  title: PipelineJobTitle | null = null,
  llmId: string | null = null,
  promptId: string | null = null,
): Promise<EmbedDocument> {
  const text = kontentItemToString(item);
  const vector = await embeddings.embedQuery(text);
  return {
    document: new Document({
      id: `${pipeline.ProductCode}__${title?.Job_Title__c ?? 'original'}`,
      pageContent: text,
      metadata: {
        pipeline_code: pipeline.ProductCode,
        pipelineName: pipeline.Name,
        title: title?.Job_Title__c ?? null,
        titleId: title?.Id ?? null,
        llmId,
        promptId,
      },
    }),
    vector: vector,
  };
}

function kontentItemToString(kontentData: KontentPipelineItem): string {
  const sections = [
    {
      name: 'Hook',
      value: kontentData.elements.hook.value,
    },
    {
      name: 'What you will be doing',
      value: kontentData.elements.what_you_will_be_doing.value,
    },
    {
      name: 'What you will not be doing',
      value: kontentData.elements.what_you_will_not_be_doing.value,
    },
    {
      name: 'Responsibilities',
      value: kontentData.elements.responsibilities.value,
    },
    {
      name: 'Requirements',
      value: kontentData.elements.requirements.value,
    },
    {
      name: 'Nice to have',
      value: kontentData.elements.nice_to_have.value,
    },
    {
      name: 'What you will learn',
      value: kontentData.elements.what_you_will_learn.value,
    },
    {
      name: 'Work Examples',
      value: kontentData.elements.work_examples.value,
    },
    {
      name: 'Primary Contribution',
      value: kontentData.elements.primary_contribution.value,
    },
  ];

  return sections
    .filter((section) => section.value != null && section.value.trim().length > 0)
    .map((section) => `${section.name}:\n${section.value}`)
    .join('\n\n');
}
