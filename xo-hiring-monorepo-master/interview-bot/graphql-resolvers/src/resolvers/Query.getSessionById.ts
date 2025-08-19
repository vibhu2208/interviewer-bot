import { Context, DynamoDBGetItemRequest } from '@aws-appsync/utils';
import { checkAuthentication, protectSession } from '../utils/data-protection';
import { getSessionKey } from '../utils/dynamodb';

export function request(ctx: Context): DynamoDBGetItemRequest {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues(getSessionKey(ctx.args.sessionId)),
  };
}

export function response(ctx: Context): boolean {
  if (ctx.error) {
    util.appendError(ctx.error.message, ctx.error.type);
  }
  checkAuthentication(ctx, ctx.result.secretKey);
  return protectSession(ctx, ctx.result);
}
