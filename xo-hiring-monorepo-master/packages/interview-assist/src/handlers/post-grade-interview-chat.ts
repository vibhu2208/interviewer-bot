import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';
import { CoreMessage, generateText, tool } from 'ai';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import Handlebars from 'handlebars';
import {
  WELCOME_MESSAGE_WITH_SUMMARY,
  WELCOME_MESSAGE_WITHOUT_SUMMARY,
} from '../constants/initial-chat-messages.constants';
import { errorResponse, successResponse } from '../integrations/api-gateway';
import { Llm } from '../integrations/llm';
import { Config } from '../models/config';
import { Conversation, ToolParams, toolParams } from '../models/conversation';
import { Prompt } from '../models/prompt';
import { Summary } from '../models/summary';
import { PipelineDataService } from '../services/pipeline-data.service';
import { AsrDataService } from '../services/asr-data.service';

const log = defaultLogger({ serviceName: 'post-grade-interview-chat' });

export async function handler(event: APIGatewayProxyWithCognitoAuthorizerEvent): Promise<APIGatewayProxyResult> {
  log.resetKeys();
  // Get ASR ID from path parameters
  const asrId = event.pathParameters?.asrId;

  if (asrId == null) {
    return errorResponse(400, 'ASR ID is required');
  }

  log.appendKeys({ asrId });

  const body = JSON.parse(event.body ?? '{}');
  const content = body.content;

  if (content == null) {
    return errorResponse(400, 'Content is required');
  }

  return handleGrading(asrId, content);
}

export async function handleGrading(asrId: string, content: string): Promise<APIGatewayProxyResult> {
  const summaryDocument = await Summary.getByAsrId(asrId);

  let conversation = await Conversation.getByAsrId(asrId);
  let systemPromptId = conversation?.promptId;
  if (systemPromptId == null) {
    const config = await Config.fetch();
    if (config == null) {
      return errorResponse(500, 'Config not found');
    }

    systemPromptId = config.gradeConversationPromptId;
  }

  const prompt = await Prompt.getById(systemPromptId);
  if (prompt == null) {
    return errorResponse(500, 'Prompt not found');
  }
  if (!conversation) {
    log.info('No existing conversation found. Starting new conversation.');
    const sfClient = await Salesforce.getDefaultClient();
    const asrService = new AsrDataService(sfClient);
    const pipelineDataService = new PipelineDataService(sfClient);
    const asrContext = await asrService.getContextualIdsFromAsr(asrId);
    if (!asrContext) {
      return errorResponse(500, 'ASR context not found');
    }
    const pipelineDescription = await pipelineDataService.getPipelineDescription(asrContext.pipelineId);
    const initialMessageContent = summaryDocument?.summary
      ? WELCOME_MESSAGE_WITH_SUMMARY
      : WELCOME_MESSAGE_WITHOUT_SUMMARY;
    const initialMessage: CoreMessage = {
      role: 'assistant',
      content: initialMessageContent,
    };

    conversation = await Conversation.upsert({
      asrId,
      promptId: prompt.id,
      context: {
        pipeline: pipelineDescription,
      },
      isComplete: false,
      messages: [initialMessage],
      toolCall: undefined,
    });

    if (!content || content === '') {
      return successResponse({ messages: conversation.messages, isComplete: conversation.isComplete });
    }
  }

  if (conversation.isComplete) {
    log.info('Conversation is complete. Skipping.');
    return successResponse({ messages: conversation.messages, isComplete: conversation.isComplete });
  }

  const compiledSystemPrompt = Handlebars.compile(prompt.system)({
    ...conversation.context,
    interview: {
      summary: summaryDocument?.summary,
      recording_url: summaryDocument?.reportUrl,
    },
  });

  const gradeInterviewTool = tool({
    description: 'Grade the interview',
    parameters: toolParams,
    execute: async (params: ToolParams) => {
      try {
        log.info('Executing tool call');

        const sf = await Salesforce.getAdminClient();

        const response = await sf.invokeApexRest('POST', `interview-assist/grade-interview/${asrId}`, undefined, {
          data: {
            decision: params.decision,
            reasoning: params.reasoning,
            gaps_in_requirements: params.gaps_in_requirements,
            recording_url: params.recording_url,
          },
        });

        log.info('Salesforce response', { response });

        return {
          sf_success: response.status === 200,
          decision: params.decision,
          reasoning: params.reasoning,
          gaps_in_requirements: params.gaps_in_requirements,
          recording_url: params.recording_url,
        };
      } catch (error) {
        log.error('Error executing tool call', { error });

        return {
          sf_success: false,
          error: `${error}`,
          decision: params.decision,
          reasoning: params.reasoning,
          gaps_in_requirements: params.gaps_in_requirements,
          recording_url: params.recording_url,
        };
      }
    },
  });

  const model = await Llm.getModel(prompt);

  const userInput: CoreMessage = { role: 'user', content };

  const response = await generateText({
    model: model,
    system: compiledSystemPrompt,
    messages: [...conversation.messages, userInput],
    tools: {
      grade_interview: gradeInterviewTool,
    },
  });

  const assistantResponse: CoreMessage = { role: 'assistant', content: response.text };
  const toolCall = response.toolCalls.find((toolCall) => toolCall.toolName === 'grade_interview');

  if (toolCall) {
    // When tool call fails assistant response should be updated with the error message
    if ('error' in toolCall.args) {
      assistantResponse.content += `\n\nError while saving the interview grade decision.`;
    } else {
      // When tool call succeeds assistant response should be extended with the tool call result
      assistantResponse.content +=
        `\n\nInterview grade decision: ${toolCall.args.decision}` +
        `\n\nReasoning: ${toolCall.args.reasoning}` +
        `\n\nGaps in requirements: ${toolCall.args.gaps_in_requirements}` +
        `\n\nRecording URL: ${toolCall.args.recording_url}`;
    }
  }

  const updatedConversation = {
    ...conversation,
    messages: [...conversation.messages, userInput, assistantResponse],
    isComplete: !!toolCall,
    toolCall: toolCall,
  };

  await Conversation.upsert(updatedConversation);

  return successResponse({ messages: updatedConversation.messages, isComplete: updatedConversation.isComplete });
}
