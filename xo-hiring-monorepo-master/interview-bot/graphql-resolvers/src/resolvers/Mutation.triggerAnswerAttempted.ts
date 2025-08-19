import { Context } from '@aws-appsync/utils';

export function request(ctx: Context): void {
  runtime.earlyReturn(ctx.arguments.data);
}

export function response(ctx: Context): boolean {
  if (ctx.error) {
    util.appendError(ctx.error.message, ctx.error.type);
  }
  return true;
}
