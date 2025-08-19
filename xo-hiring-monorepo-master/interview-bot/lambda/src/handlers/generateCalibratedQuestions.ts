import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../common/logger';
import { Sqs } from '../integrations/sqs';
import { CalibratedQuestionStatus } from '../model/calibrated-question';

const log = Logger.create('generateCalibratedQuestions');

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  log.plain('EVENT', event);

  const input: GenerateCalibratedQuestionsRequest = JSON.parse(event.body ?? '{}');

  if (!input.skillId) {
    log.error(`Input does not contain skillId`);
    return {
      statusCode: 400,
      body: JSON.stringify({
        success: false,
        error: `skillId should be provided`,
      }),
    };
  }

  await Sqs.triggerGenerateCalibratedQuestions(input.skillId, input.targetStatus, input.questionsCount);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
    }),
  };
}

export interface GenerateCalibratedQuestionsRequest {
  skillId?: string;
  targetStatus?: CalibratedQuestionStatus;
  questionsCount?: number;
}
