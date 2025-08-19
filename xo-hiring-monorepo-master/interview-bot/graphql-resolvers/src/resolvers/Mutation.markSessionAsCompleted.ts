import { Context, DynamoDBUpdateItemRequest } from '@aws-appsync/utils';
import { getSessionKey } from '../utils/dynamodb';

export function request(ctx: Context): DynamoDBUpdateItemRequest {
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues(getSessionKey(ctx.args.sessionId)),
    update: {
      expression: 'SET #state = :state, #endTime = :endTime',
      expressionNames: {
        '#state': 'state',
        '#endTime': 'endTime',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':state': 'Completed',
        ':endTime': util.time.nowISO8601(),
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
