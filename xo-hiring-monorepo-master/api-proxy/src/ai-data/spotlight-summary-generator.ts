import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  defaultLogger,
  InterviewBotClient,
  InterviewConversation,
  Salesforce,
  SecretsManager,
} from '@trilogy-group/xoh-integration';
import Handlebars from 'handlebars';
import OpenAI from 'openai';
import { envVal, MainTableKeys } from '../internal-handlers/integrations/dynamodb';
import { CandidateAssessment, fetchCandidateAssessments, fetchCandidateResume, getBadgesData } from './candidate';
import { fetchKontentPipelineData } from './pipeline';
import { Prompt } from './prompt.model';
import { SpotlightDefaultPromptId, SpotlightTask } from './spotlight-task.model';
import { TaskStatus } from './task.model';

const log = defaultLogger({ serviceName: 'ai-data-spotlight-gen' });

interface PromptLensSecret {
  API_URL: string;
  API_KEY: string;
}

export async function handler(key: MainTableKeys): Promise<void> {
  log.info('Spotlight summary generator invoked', { key });

  // Check env vars are set
  envVal('AI_DATA_TABLE_NAME');
  envVal('IB_TABLE_NAME');
  envVal('PROMPTLENS_SECRET_NAME');

  const task = await SpotlightTask.getSpotlightByKey(key);
  if (task == null) {
    log.error('Task not found', { key });
    return;
  }
  log.appendKeys({
    candidateId: task.candidateId,
    pipelineId: task.pipelineId,
  });

  const prompt = await Prompt.getPromptByName(task.promptId ?? SpotlightDefaultPromptId);
  if (prompt == null) {
    log.error(`Prompt not found: ${task.promptId}`);
    await SpotlightTask.saveTask({
      ...task,
      status: TaskStatus.ERROR,
      lastUpdateTime: new Date().toISOString(),
      error: `Prompt not found`,
    });
    return;
  }

  try {
    log.info('Preparing information for the task');
    const sf = await Salesforce.getDefaultClient();

    const [pipelineData, candidateData, assessments, promptLensSecret] = await Promise.all([
      fetchKontentPipelineData(sf, task.pipelineId),
      fetchCandidateResume(task.candidateId),
      fetchCandidateAssessments(sf, task.candidateId),
      SecretsManager.fetchSecretJson<PromptLensSecret>(process.env.PROMPTLENS_SECRET_NAME!),
    ]);

    if (promptLensSecret == null) {
      throw new Error('PromptLens secret is not available');
    }

    const badges = getBadgesData(assessments);
    const matchingInterviewData = await fetchMatchingInterviewData(assessments);

    log.info(`Preparing prompt for the LLM`);
    const context = {
      pipeline: pipelineData,
      candidate: candidateData,
      badges,
      interviews: matchingInterviewData,
    };
    const promptTemplate = Handlebars.compile(prompt.template, {
      noEscape: true,
    });
    const finalPrompt = promptTemplate(context);
    log.info(`Prompt for the LLM`, { finalPrompt });
    let output = null;
    try {
      // TODO: If we validate that promptlens is good for us and we plan on expanding this, it NEEDS to be extracted properly to not replicate code all around
      // TODO: For now, keeping it simple so reverting the changes is less impactful as we are just using it here to gather data.
      const client = new OpenAI({
        apiKey: promptLensSecret.API_KEY,
        baseURL: promptLensSecret.API_URL,
      });
      const model = `crossover-hire/bedrock/${prompt.model ?? 'us.anthropic.claude-3-5-sonnet-20240620-v1:0'}`;
      log.info(`Using model`, { model });
      log.info(`Using prompt config`, { prompt });

      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: finalPrompt,
          },
        ],
        temperature: prompt.temperature,
        metadata: {
          service: 'spotlight',
          task: 'generate-summary',
        },
      });

      output = response.choices[0]?.message?.content ?? null;
      log.info(`Output from LLM`, { output });
    } catch (error) {
      // Fallback if promptlens is not available. This will (in theory) be automatically done when we have the llm
      const client = new BedrockRuntimeClient();
      const response = await client.send(
        new ConverseCommand({
          messages: [
            {
              role: 'user',
              content: [
                {
                  text: finalPrompt,
                },
              ],
            },
          ],
          modelId: prompt.model ?? 'anthropic.claude-3-5-sonnet-20240620-v1:0',
          inferenceConfig: {
            temperature: prompt.temperature,
          },
        }),
      );
      output = response.output?.message?.content?.[0]?.text ?? null;
      log.info(`Output from LLM`, { output });
    }

    // Update task status to COMPLETED
    await SpotlightTask.saveTask({
      ...task,
      status: TaskStatus.COMPLETED,
      summary: output ?? undefined,
      prompt: finalPrompt,
      lastUpdateTime: new Date().toISOString(),
    });

    log.info('Spotlight summary generated successfully');
  } catch (error) {
    log.error('Error generating spotlight summary', error as Error);

    await SpotlightTask.saveTask({
      ...task,
      status: TaskStatus.ERROR,
      lastUpdateTime: new Date().toISOString(),
      error: `${(error as Error).message}`,
    });
  }
}

function getInterviewBotClient() {
  const interviewBotApiUrl = envVal('INTERVIEW_BOT_API_URL');
  return new InterviewBotClient(interviewBotApiUrl);
}

export async function fetchMatchingInterviewData(assessments: CandidateAssessment[]): Promise<MatchingInterviewData[]> {
  try {
    const xoAssessments = assessments.filter((it) => it.Application_Step_Id__r.Provider__c === 'XOAssessments');
    const sessionIds = xoAssessments.map((it) => it.External_Submission_Id__c).filter((it): it is string => it != null);

    if (sessionIds.length === 0) {
      log.info('No XOAssessments with session IDs found for candidate.');
      return [];
    }

    log.info(`Fetching matching interview logs for ${sessionIds.length} assessments via InterviewBotClient.`);
    const interviewConversations: InterviewConversation[] = await getInterviewBotClient().fetchInterviewConversations({
      sessionIds,
    });

    const result: MatchingInterviewData[] = interviewConversations.map((logEntry) => {
      const assessment = xoAssessments.find((a) => a.External_Submission_Id__c === logEntry.sessionId);
      return {
        name: assessment?.Application_Step_Id__r.Display_Name__c ?? '',
        conversation: logEntry.conversation.map((c: { role: string; content: string }) => ({
          role: c.role,
          content: c.content,
        })),
      };
    });

    log.info(`Successfully fetched and mapped ${result.length} interview logs.`);
    return result;
  } catch (e) {
    log.error('Error fetching or processing matching interview data via InterviewBotClient', e as Error);
    return [];
  }
}

interface MatchingInterviewData {
  name: string;
  conversation: {
    content: string;
    role: string;
  }[];
}
