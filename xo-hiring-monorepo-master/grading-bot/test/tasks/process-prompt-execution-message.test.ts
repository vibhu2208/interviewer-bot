import { GradeCandidateSubmission } from '../../src/common/openai-grading-functions';
import { ChatGpt } from '../../src/integrations/chatgpt';
import { DynamoDB } from '../../src/integrations/dynamodb';
import { PromptExecutionTask } from '../../src/model/prompt-execution-task';
import { processPromptExecutionMessage } from '../../src/tasks/process-prompt-execution-message';

describe('processPromptExecutionMessage', () => {
  it('should invoke OpenAI api and store output', async () => {
    // Arrange
    const promptExecutionKey = { pk: 'PK', sk: 'SK' };
    const task = PromptExecutionTask.newDocumentWithPromptFor('system', 'user', promptExecutionKey, {
      id: '1',
    });

    DynamoDB.getDocument = jest.fn().mockResolvedValue(task);
    DynamoDB.putDocument = jest.fn();
    ChatGpt.createCompletionReturnMessage = jest.fn().mockResolvedValue({
      content: 'Test content',
      tool_calls: [
        {
          function: {
            name: GradeCandidateSubmission.name,
            arguments: JSON.stringify({
              result: 'Pass',
              confidence: 0.9,
              reasoning: 'Yes',
              feedback: 'True',
            }),
          },
        },
      ],
    });
    PromptExecutionTask.incrementExecutedTaskCounter = jest.fn();

    // Act
    await processPromptExecutionMessage({
      type: 'execute-prompt',
      taskId: '1',
      promptExecutionKey,
    });

    // Assert
    expect(ChatGpt.createCompletionReturnMessage).toHaveBeenCalledWith(
      task.messages,
      expect.objectContaining({ tools: expect.any(Array) }),
      expect.any(Object),
    );
    expect(DynamoDB.putDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: task.id,
        grading: {
          result: 'Pass',
          confidence: 0.9,
          reasoning: 'Yes',
          feedback: 'True',
        },
        modifiedAt: expect.any(String),
      }),
    );
    expect(PromptExecutionTask.incrementExecutedTaskCounter).toHaveBeenCalledWith(task.parentKey);
  });
});
