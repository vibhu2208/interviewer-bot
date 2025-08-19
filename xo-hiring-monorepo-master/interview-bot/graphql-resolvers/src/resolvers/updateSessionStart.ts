import { Context, DynamoDBUpdateItemRequest } from '@aws-appsync/utils';
import { getSessionKey } from '../utils/dynamodb';

export function request(ctx: Context): DynamoDBUpdateItemRequest {
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues(getSessionKey(ctx.source.id)),
    update: {
      expression: 'SET #state = :state, #startTime = :startTime',
      expressionNames: {
        '#state': 'state',
        '#startTime': 'startTime',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':state': 'Started',
        ':startTime': util.time.nowISO8601(),
      }),
    },
    condition: {
      expression: 'attribute_not_exists(#startTime) AND #state = :prevState',
      expressionNames: {
        '#state': 'state',
        '#startTime': 'startTime',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':prevState': 'Ready',
      }),
    },
  };
}

export function response(ctx: Context): boolean {
  if (ctx.error) {
    // It is expected to have this field set as some point
    if (ctx.error.type !== 'DynamoDB:ConditionalCheckFailedException') {
      util.appendError(ctx.error.message, ctx.error.type);
    }
  }
  return ctx.prev.result;
}
