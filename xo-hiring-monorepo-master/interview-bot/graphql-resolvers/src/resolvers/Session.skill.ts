import { Context, DynamoDBGetItemRequest } from '@aws-appsync/utils';
import { getSkillKey } from '../utils/dynamodb';

export function request(ctx: Context): DynamoDBGetItemRequest {
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues(getSkillKey(ctx.source.skillId)),
  };
}

export function response(ctx: Context): boolean {
  if (ctx.error) {
    util.appendError(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
