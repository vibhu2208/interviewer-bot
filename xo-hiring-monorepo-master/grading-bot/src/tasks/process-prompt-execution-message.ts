import { Logger } from '../common/logger';
import { NonRetryableError } from '../common/non-retryable-error';
import { GradeCandidateSubmission } from '../common/openai-grading-functions';
import { Config } from '../config';
import { ChatGpt, getToolInvocation } from '../integrations/chatgpt';
import { DynamoDB } from '../integrations/dynamodb';
import { SqsExecutePromptMessage } from '../integrations/sqs';
import { PromptExecutionTask, PromptExecutionTaskDocument } from '../model/prompt-execution-task';

const log = Logger.create('prompt-execution');

export async function processPromptExecutionMessage(message: SqsExecutePromptMessage): Promise<void> {
  let logContext = log.context(message);

  const promptTask = await DynamoDB.getDocument<PromptExecutionTaskDocument>(message.promptExecutionKey);
  if (promptTask == null) {
    throw new Error(`Cannot find task in the DDB: ${JSON.stringify(message.promptExecutionKey)}`);
  }
  logContext = {
    ...logContext,
    ...promptTask.logContext,
  };

  try {
    log.info(`Calling GPT to create chat completion`, logContext);
    const gptMessage = await ChatGpt.createCompletionReturnMessage(
      promptTask.messages,
      {
        tools: [
          {
            type: 'function',
            function: GradeCandidateSubmission,
          },
        ],
        tool_choice: {
          type: 'function',
          function: {
            name: GradeCandidateSubmission.name,
          },
        },
        ...promptTask.config,
      },
      logContext,
    );

    if (gptMessage === null) {
      throw new Error('GPT did not return expected message');
    }

    const gradingToolCall = getToolInvocation(gptMessage, GradeCandidateSubmission.name);
    if (gradingToolCall != null) {
      promptTask.grading = JSON.parse(gradingToolCall.function.arguments);
      promptTask.modifiedAt = new Date().toISOString();

      await DynamoDB.putDocument(promptTask);
      await PromptExecutionTask.incrementExecutedTaskCounter(promptTask.parentKey);
    } else {
      throw new Error(`Cannot find function call of ${GradeCandidateSubmission.name}`);
    }
  } catch (e) {
    // Store error on the processing task
    const message = (e as Error).message;
    log.error(`Error during prompt execution task: ${message}`, e, logContext);
    promptTask.errors = [...(promptTask.errors ?? []), `${new Date().toISOString()}: ${message}`];
    promptTask.modifiedAt = new Date().toISOString();
    await DynamoDB.putDocument(promptTask);

    if (e instanceof NonRetryableError || promptTask.errors.length >= Config.getNumRetires()) {
      // If we will not retry anymore, we will still notify parent task about completion
      await PromptExecutionTask.incrementExecutedTaskCounter(promptTask.parentKey);
    }

    // Propagate to parent call
    throw e;
  }
}
