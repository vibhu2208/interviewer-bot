import { BedrockRuntimeClient, ContentBlock, ConverseCommand, DocumentFormat } from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand, HeadObjectCommand, S3 } from '@aws-sdk/client-s3';
import { defaultLogger, Salesforce, SalesforceClient } from '@trilogy-group/xoh-integration';
import Handlebars from 'handlebars';
import { envVal, MainTableKeys } from '../internal-handlers/integrations/dynamodb';
import { ApplyEmailDefaultPromptId, ApplyEmailTask, ApplyEmailTaskDocument } from './apply-email-task.model';
import { fetchCandidateAssessments, fetchCandidateDetails, fetchCandidateResume, getBadgesData } from './candidate';
import { fetchKontentPipelineData } from './pipeline';
import { Prompt } from './prompt.model';
import { TaskStatus } from './task.model';

const s3 = new S3();

const log = defaultLogger({ serviceName: 'ai-data-apply-email-gen' });

/**
 * Lambda handler for generating apply email content
 */
export async function handler(key: MainTableKeys): Promise<void> {
  log.info('Apply email content generator invoked', { key });

  // Check env vars are set
  envVal('AI_DATA_TABLE_NAME');
  envVal('IB_TABLE_NAME');

  const task = await ApplyEmailTask.getByKey(key);
  if (task == null) {
    log.error('Task not found', { key });
    return;
  }
  log.appendKeys({
    candidateId: task.candidateId,
    applicationId: task.applicationId,
  });

  const prompt = await Prompt.getPromptByName(task.promptId ?? ApplyEmailDefaultPromptId);
  if (prompt == null) {
    log.error(`Prompt not found: ${task.promptId}`);
    await ApplyEmailTask.save({
      ...task,
      status: TaskStatus.ERROR,
      lastUpdateTime: new Date().toISOString(),
      error: `Prompt not found`,
    });
    return;
  }

  try {
    log.info('Preparing information for the task');
    const context = await buildContext(task);

    const promptTemplate = Handlebars.compile(prompt.template, { noEscape: true });
    const finalPrompt = promptTemplate(context);

    log.info(`Prompt for the LLM`, { finalPrompt });

    const client = new BedrockRuntimeClient();

    const content: ContentBlock[] = [
      {
        text: finalPrompt,
      },
    ];
    const rawResume = context.rawResume;
    if (rawResume) {
      content.push({
        document: {
          format: getResumeFormat(rawResume.extension),
          name: rawResume.fileName,
          source: { bytes: rawResume.content },
        },
      });
    }

    const response = await client.send(
      new ConverseCommand({
        messages: [
          {
            role: 'user',
            content: content,
          },
        ],
        // 3.5 sonnet does not support document format
        modelId: prompt.model ?? 'anthropic.claude-3-sonnet-20240229-v1:0',
        inferenceConfig: { temperature: prompt.temperature },
        toolConfig: {
          toolChoice: {
            tool: { name: createEmailToolSpec().toolSpec.name },
          },
          tools: [createEmailToolSpec()],
        },
      }),
    );

    const result = (response.output?.message?.content?.[0]?.toolUse?.input ?? {}) as Record<string, string>;
    log.info(`Output from LLM`, { toolUse: result });

    await ApplyEmailTask.save({
      ...task,
      status: TaskStatus.COMPLETED,
      subject: result['subject'] ?? undefined,
      body: result['body'] ?? undefined,
      prompt: finalPrompt,
      lastUpdateTime: new Date().toISOString(),
    });

    log.info('Apply email content generated successfully');
  } catch (error) {
    log.error('Error generating apply email content', error as Error);

    await ApplyEmailTask.save({
      ...task,
      status: TaskStatus.ERROR,
      lastUpdateTime: new Date().toISOString(),
      error: `${(error as Error).message}`,
    });
  }
}

async function buildContext(task: ApplyEmailTaskDocument) {
  const sf = await Salesforce.getDefaultClient();
  const pipelineInfo = await fetchApplicationPipeline(sf, task.applicationId);

  const [pipeline, candidate, candidateDetails, assessments, rawResume] = await Promise.all([
    fetchKontentPipelineData(sf, pipelineInfo?.[0]?.Pipeline__c),
    fetchCandidateResume(task.candidateId),
    fetchCandidateDetails(sf, task.candidateId),
    fetchCandidateAssessments(sf, task.candidateId),
    downloadResume(task.candidateId),
  ]);

  const context = {
    badges: getBadgesData(assessments),
    resume: candidate.resume,
    profile: candidate.profile,
    candidate: candidateDetails?.[0],
    pipeline: pipeline,
    rawResume: rawResume,
  };

  return context;
}

async function fetchApplicationPipeline(sf: SalesforceClient, applicationId: string) {
  return await sf.querySOQL<{ Id: string; Name: string; Pipeline__c: string }>(`
    SELECT 
      Id, 
      Name, 
      Pipeline__c
    FROM Opportunity 
    WHERE Id = '${applicationId}'
  `);
}

function createEmailToolSpec() {
  return {
    toolSpec: {
      name: 'create_email',
      description: 'Create an email from a prompt',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            subject: {
              type: 'string',
              description: 'The subject of the email',
            },
            body: {
              type: 'string',
              description: 'The body of the email',
            },
          },
        },
      },
    },
  };
}

/**
 * Download resume from S3
 * @param candidateId Candidate ID
 * @returns Resume content
 */
async function downloadResume(candidateId: string): Promise<{
  fileName: string;
  extension: string;
  content: Uint8Array;
} | null> {
  try {
    const getObjectParams = {
      Bucket: process.env.S3_BUCKET_RESUMES,
      Key: candidateId,
    };

    const [contentResponse, headObjectResponse] = await Promise.all([
      s3.send(new GetObjectCommand(getObjectParams)),
      s3.send(new HeadObjectCommand(getObjectParams)),
    ]);

    const originalFileExtension = headObjectResponse.Metadata?.['original-file-extension'];
    const originalFileName = headObjectResponse.Metadata?.['original-file-name'];

    log.info('Downloaded resume', { candidateId, originalFileName, originalFileExtension });

    if (contentResponse.Body) {
      return {
        fileName: 'Resume',
        extension: originalFileExtension ?? 'pdf',
        content: await contentResponse.Body.transformToByteArray(),
      };
    }
  } catch (error) {
    log.error('Error downloading resume', error as Error);
  }

  log.info('Could not download candidate resume from S3');

  return null;
}

/**
 * Only support PDF, DOCX, DOC formats
 */
function getResumeFormat(extension: string): DocumentFormat | undefined {
  if (extension == 'pdf' || extension == 'docx' || extension == 'doc') {
    return extension;
  }

  return 'pdf';
}
