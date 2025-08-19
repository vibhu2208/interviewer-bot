import { Context, LambdaRequest } from '@aws-appsync/utils';

export function request(ctx: Context): LambdaRequest {
  return {
    operation: 'Invoke',
    payload: ctx,
  };
}

export function response(ctx: Context): boolean {
  if (ctx.error) {
    util.appendError(ctx.error.message, ctx.error.type);
  }
  return ctx.result;
}
