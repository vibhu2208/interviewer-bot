import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';
import { Config, ProjectName } from '../config';

const editor = new SsmEditor({
  productName: ProjectName,
  environment: Config.getEnv(),
});
let cachedConfig: InterviewBotSsmConfig;

export class Ssm {
  static async getForEnvironment(): Promise<InterviewBotSsmConfig> {
    if (cachedConfig) {
      return cachedConfig;
    }
    cachedConfig = (await editor.getConfigurationObject({
      parametersPrefix: `/${ProjectName}/${Config.getEnv()}/interview-bot/`,
      transformKebabToCamel: true,
    })) as InterviewBotSsmConfig;
    return cachedConfig;
  }
}

export interface InterviewBotSsmConfig {
  delayGradingEventsForSeconds: number;
}
