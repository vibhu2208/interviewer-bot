import { Context, DynamoDBQueryRequest } from '@aws-appsync/utils';
import { checkAuthentication, protectQuestions } from '../utils/data-protection';
import { getSessionKey } from '../utils/dynamodb';

export function request(ctx: Context): DynamoDBQueryRequest {
  return {
    operation: 'Query',
    query: {
      expression: '#pk = :pk AND begins_with(#sk, :sk)',
      expressionNames: {
        '#pk': 'pk',
        '#sk': 'sk',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':pk': getSessionKey(ctx.source.id).pk,
        ':sk': 'QUESTION#',
      }),
    },
  };
}

export function response(ctx: Context): boolean {
  if (ctx.error) {
    util.appendError(ctx.error.message, ctx.error.type);
  }
  checkAuthentication(ctx, ctx.source.secretKey); // Parent is Session
  return protectQuestions(ctx, ctx.result.items ?? []);
}
