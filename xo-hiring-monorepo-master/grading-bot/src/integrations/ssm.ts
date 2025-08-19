import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';
import { Config, ProjectName } from '../config';

const editor = new SsmEditor({
  productName: ProjectName,
  environment: Config.getEnv(),
});
let cachedConfig: GradingBotSsmConfig;

export class Ssm {
  static async getForEnvironment(): Promise<GradingBotSsmConfig> {
    if (cachedConfig) {
      return cachedConfig;
    }
    const cfg = (await editor.getConfigurationObject({
      parametersPrefix: `/${ProjectName}/${Config.getEnv()}/grading-bot/`,
      transformKebabToCamel: true,
    })) as GradingBotSsmConfig;
    cfg.prompts.unstructuredSystem = unEscapePrompt(cfg.prompts.unstructuredSystem);
    cfg.prompts.unstructuredUser = unEscapePrompt(cfg.prompts.unstructuredUser);
    cfg.prompts.structuredSystem = unEscapePrompt(cfg.prompts.structuredSystem);
    cfg.prompts.structuredUser = unEscapePrompt(cfg.prompts.structuredUser);
    cachedConfig = cfg;
    return cachedConfig;
  }
}

/**
 * Due to SSM limitations we replace {{x}} with [[x]] in the prompts stored there
 * Here we will transform it back to Handlebars syntax
 * @param text
 */
function unEscapePrompt(text: string): string {
  return text.replace(/\[\[/gm, '{{').replace(/]]/gim, '}}');
}

export interface GradingBotSsmConfig {
  prompts: {
    structuredSystem: string;
    structuredUser: string;
    unstructuredSystem: string;
    unstructuredUser: string;
  };
  delayGradingEventsForSeconds: string;
}
