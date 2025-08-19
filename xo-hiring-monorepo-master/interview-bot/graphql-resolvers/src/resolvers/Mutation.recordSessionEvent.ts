import { Context, DynamoDBUpdateItemRequest } from '@aws-appsync/utils';
import { getSessionKey } from '../utils/dynamodb';

const EventNames = ['tabVisibilityLost'];

export function request(ctx: Context): DynamoDBUpdateItemRequest {
  if (!EventNames.includes(ctx.args.eventName)) {
    util.error(`Unknown eventName: ${ctx.args.eventName}`);
  }
  return {
    operation: 'UpdateItem',
    key: util.dynamodb.toMapValues(getSessionKey(ctx.args.sessionId)),
    update: {
      // Use list_append to add the new event to sessionEvents, and if_not_exists to initialize it if necessary
      expression: 'SET #sessionEvents = list_append(if_not_exists(#sessionEvents, :emptyList), :newEvent)',
      expressionNames: {
        '#sessionEvents': 'sessionEvents',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':newEvent': [{ type: ctx.args.eventName, time: util.time.nowISO8601() }],
        ':emptyList': [],
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
