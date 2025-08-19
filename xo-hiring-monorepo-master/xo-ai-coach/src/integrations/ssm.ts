import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';
import { Config, ProjectName } from '../config';

const editor = new SsmEditor({
  productName: ProjectName,
  environment: Config.getEnv(),
});
let cachedConfig: XoAiCoachSsmConfig;

export class Ssm {
  static async getForEnvironment(): Promise<XoAiCoachSsmConfig> {
    if (cachedConfig) {
      return cachedConfig;
    }
    const rawConfig = (await editor.getConfigurationObject({
      parametersPrefix: `/${ProjectName}/${Config.getEnv()}/xo-ai-coach/`,
      transformKebabToCamel: true,
    })) as XoAiCoachSsmConfigRaw;
    cachedConfig = JSON.parse(rawConfig.config);
    return cachedConfig;
  }
}

interface XoAiCoachSsmConfigRaw {
  config: string;
}

export interface XoAiCoachSsmConfig {
  whitelistTeamIds?: number[];
}
