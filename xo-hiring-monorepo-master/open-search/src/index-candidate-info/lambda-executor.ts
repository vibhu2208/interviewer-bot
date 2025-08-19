import { PROFILES_QUERY } from '../common/constants';
import { Row } from 'aws-sdk/clients/athena';
import { BaseLambdaExecutor, LambdaContext } from '../common/base-lambda-executor';

export class LambdaExecutor extends BaseLambdaExecutor {
  constructor(ctx: LambdaContext) {
    super(ctx, PROFILES_QUERY);
  }

  protected convertRow(row: Row): object {
    const { Data } = row;
    return {
      [`${this.ctx.event.headerRow?.[0]}`]: Data?.[0].VarCharValue, // candidateId
      [`${this.ctx.event.headerRow?.[1]}`]: Data?.[1].VarCharValue, // resumeProfile
    };
  }
}
