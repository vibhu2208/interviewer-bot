import { Context, DynamoDBUpdateItemRequest } from '@aws-appsync/utils';
import { getSessionKey } from '../utils/dynamodb';

export function request(ctx: Context): DynamoDBUpdateItemRequest {
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues(getSessionKey(ctx.args.sessionId)),
    update: {
      expression: 'SET #feedback = :feedback',
      expressionNames: {
        '#feedback': 'feedback',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':feedback': {
          perception: ctx.args.perception,
          comment: ctx.args.comment,
        },
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
