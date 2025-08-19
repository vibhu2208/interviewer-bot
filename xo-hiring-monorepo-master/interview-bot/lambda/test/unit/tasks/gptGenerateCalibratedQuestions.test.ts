import { Llm } from '@trilogy-group/xoh-integration';
import { generateObject } from 'ai';
import { DynamoDB } from '../../../src/integrations/dynamodb';
import { QuestionGenerator } from '../../../src/model/question-generator';
import { Skill } from '../../../src/model/skill';
import { LLMProjectName } from '../../../src/config';
import {
  gptGenerateCalibratedQuestions,
  GptGeneratedQuestion,
} from '../../../src/tasks/gptGenerateCalibratedQuestions';

jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

describe('gptGenerateCalibratedQuestions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Should generate calibrated questions using LLM', async () => {
    // Arrange
    Skill.getById = jest.fn().mockResolvedValue({
      id: '1',
      generatorId: '2',
    });
    QuestionGenerator.getById = jest.fn().mockResolvedValue({
      id: '2',
      questionPrompt: {
        system: 'skill id: {{skill.id}}',
        user: 'questions count: {{questionsCount}}',
      },
    });

    const mockModel = {};
    Llm.getDefaultModel = jest.fn().mockResolvedValue(mockModel);
    (generateObject as jest.Mock).mockResolvedValue({
      object: {
        questions: [
          {
            index: 1,
            level: 'Easy',
            question: 'q',
            perfectAnswer: 'pa',
            gradingRubric: 'rubric',
          },
          {
            index: 2,
            level: 'Typical',
            question: 'q2',
            perfectAnswer: 'pa2',
            gradingRubric: 'rubric2',
          },
        ] as GptGeneratedQuestion[],
      },
    });
    DynamoDB.putDocuments = jest.fn();

    // Act
    await gptGenerateCalibratedQuestions({
      type: 'generate-questions',
      targetStatus: 'Review',
      questionsCount: 2,
      skillId: '1',
    });

    // Assert
    expect(Skill.getById).toBeCalledWith('1');
    expect(Llm.getDefaultModel).toBeCalledWith(LLMProjectName);
    expect(generateObject).toBeCalledWith({
      system: 'skill id: 1',
      prompt: 'questions count: 2',
      schema: expect.any(Object),
      temperature: 0,
      model: mockModel,
    });
    expect(DynamoDB.putDocuments).toBeCalledTimes(1);
    const documents = (DynamoDB.putDocuments as jest.Mock).mock.calls[0][0];
    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      question: 'q',
      perfectAnswer: 'pa',
      level: 'Easy',
      status: 'Review',
      gradingRubric: 'rubric',
    });
    expect(documents[1]).toMatchObject({
      question: 'q2',
      perfectAnswer: 'pa2',
      level: 'Typical',
      status: 'Review',
      gradingRubric: 'rubric2',
    });
  });
});
