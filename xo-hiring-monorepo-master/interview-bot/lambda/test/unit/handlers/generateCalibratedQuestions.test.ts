import { GenerateCalibratedQuestionsRequest, handler } from '../../../src/handlers/generateCalibratedQuestions';
import { Sqs } from '../../../src/integrations/sqs';

describe('generateCalibratedQuestions', () => {
  test('Should send sqs message on valid input', async () => {
    // Arrange
    Sqs.triggerGenerateCalibratedQuestions = jest.fn();

    // Act
    const result = await handler({
      body: JSON.stringify({
        questionsCount: 5,
        targetStatus: 'Calibration',
        skillId: '1234',
      } as GenerateCalibratedQuestionsRequest),
    } as any);

    // Assert
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).success).toBe(true);
    expect(Sqs.triggerGenerateCalibratedQuestions).toBeCalledWith('1234', 'Calibration', 5);
  });

  test('Should fail on missing skill id', async () => {
    // Arrange
    Sqs.triggerGenerateCalibratedQuestions = jest.fn();

    // Act
    const result = await handler({
      body: JSON.stringify({
        questionsCount: 5,
        targetStatus: 'Calibration',
      } as GenerateCalibratedQuestionsRequest),
    } as any);

    // Assert
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).success).toBe(false);
    expect(Sqs.triggerGenerateCalibratedQuestions).toBeCalledTimes(0);
  });
});
