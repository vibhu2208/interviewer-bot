import { CANDIDATES_QUERY } from '../common/constants';
import { Row } from 'aws-sdk/clients/athena';
import { BaseLambdaExecutor, LambdaContext } from '../common/base-lambda-executor';
import { TimeUtils } from '../common/time-utils';

export class LambdaExecutor extends BaseLambdaExecutor {
  constructor(ctx: LambdaContext) {
    super(ctx, CANDIDATES_QUERY);
  }

  protected convertRow(row: Row): object {
    const { Data } = row;
    const converted = {
      [`${this.ctx.event.headerRow?.[0]}`]: Data?.[0].VarCharValue, // candidateId
      [`${this.ctx.event.headerRow?.[1]}`]: Data?.[1].VarCharValue, // country
      [`${this.ctx.event.headerRow?.[2]}`]: this.parseLastActivity(Data?.[2].VarCharValue), // lastActivity
      [`${this.ctx.event.headerRow?.[4]}`]: this.parseMinCompensationPerHour(Data?.[4].VarCharValue), // minCompPerHr
      [`${this.ctx.event.headerRow?.[5]}`]: this.parseJobTitles(Data?.[5].VarCharValue), // jobTitles
      [`${this.ctx.event.headerRow?.[6]}`]: this.parseBadges(Data?.[6].VarCharValue),
      [`${this.ctx.event.headerRow?.[7]}`]: Data?.[7].VarCharValue, // availability
      [`${this.ctx.event.headerRow?.[8]}`]: this.parseIsEmailBounced(Data?.[8].VarCharValue), // isEmailBounced
    };
    const timezoneOffset = TimeUtils.getTimezoneOffsetToUTCNoDST(Data?.[3].VarCharValue);
    if (timezoneOffset != null) {
      // add timezone if it is not empty only, convert from minutes to hours
      converted[`${this.ctx.event.headerRow?.[3]}`] = timezoneOffset / 60;
    }

    return converted;
  }

  private parseIsEmailBounced(value: string | undefined) {
    return typeof value === 'string' ? value.toLowerCase() === 'true' : false;
  }

  private parseLastActivity(value: string | undefined) {
    return typeof value === 'string' ? new Date(Date.parse(value)).toISOString() : null;
  }

  private parseMinCompensationPerHour(value: string | undefined) {
    return typeof value === 'string' ? parseInt(value) : 0;
  }

  private parseJobTitles(value: string | undefined): string[] {
    return typeof value === 'string' ? JSON.parse(value) : [];
  }

  private parseBadges(value: string | undefined): object[] {
    if (typeof value === 'string') {
      const json: Array<{ id: string; stars: number }> = JSON.parse(value);
      return json.map((x) => {
        return {
          id: x.id,
          stars: x.stars,
        };
      });
    } else {
      return [];
    }
  }
}
