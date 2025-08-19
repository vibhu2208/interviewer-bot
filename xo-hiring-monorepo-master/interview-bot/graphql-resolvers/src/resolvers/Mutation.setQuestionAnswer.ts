import { Context, DynamoDBUpdateItemRequest } from '@aws-appsync/utils';
import { getQuestionKey } from '../utils/dynamodb';

export function request(ctx: Context): DynamoDBUpdateItemRequest {
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues(getQuestionKey(ctx.args.sessionId, ctx.args.questionId)),
    update: {
      expression: 'SET #answer = :answer, #state = :state',
      expressionNames: {
        '#answer': 'answer',
        '#state': 'state',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':answer': ctx.args.answer,
        ':state': 'Completed',
      }),
    },
  };
}

export function response(ctx: Context): boolean {
  if (ctx.error) {
    util.appendError(ctx.error.message, ctx.error.type);
  }
  return true;
}
