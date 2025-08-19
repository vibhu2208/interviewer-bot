import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';

const editor = new SsmEditor({
  productName: 'xo-hiring',
  environment: process.env.ENV ?? 'sandbox',
});

let cachedConfig: XoHiringSfAPISSMConfig;

export class SSMConfig {
  /**
   * Get SSM config for this project/environment
   * Will be cached for subsequent executions
   */
  public static async getForEnvironment(): Promise<XoHiringSfAPISSMConfig> {
    if (cachedConfig) {
      return cachedConfig;
    }

    // Fetch raw config
    const rawSSMConfig: XoHiringSfAPIRawSSMConfig = await editor.getConfigurationObject({
      parametersPrefix: `/xo-hiring/${process.env.ENV}/sf-api/`,
      transformKebabToCamel: true,
    });

    // Perform transformation
    cachedConfig = {
      opensearch: JSON.parse(rawSSMConfig.opensearch),
      chatgpt: {
        candidateExecutiveSummary: JSON.parse(rawSSMConfig.chatgpt.candidateExecutiveSummary),
      },
      cases: JSON.parse(rawSSMConfig.cases),
      kontentProjectId: rawSSMConfig.kontentProjectId,
      kontentManagementApiKey: rawSSMConfig.kontentManagementApiKey,
      kontentPreviewApiKey: rawSSMConfig.kontentPreviewApiKey,
      kontentProxyUrl: rawSSMConfig.kontentProxyUrl,
      kontentWebhookSecret: rawSSMConfig.kontentWebhookSecret,
      candidateRemovalSecretKey: rawSSMConfig.candidateRemovalSecretKey,
    };

    return cachedConfig;
  }
}

/**
 * Private raw config (some values as stored as json string and should be post-processed)
 */
interface XoHiringSfAPIRawSSMConfig {
  opensearch: string;
  chatgpt: {
    candidateExecutiveSummary: string;
  };
  cases: string;
  kontentProjectId: string;
  kontentProxyUrl: string;
  kontentPreviewApiKey: string;
  kontentManagementApiKey: string;
  kontentWebhookSecret: string;
  candidateRemovalSecretKey: string;
}

/**
 * Processed SSM config
 */
export interface XoHiringSfAPISSMConfig {
  opensearch: {
    serviceName: 'es' | 'aoss';
    endpoint: string;
    role: string;
  };
  chatgpt: {
    candidateExecutiveSummary: {
      executiveSummaryKeywords: string;
      executiveSummaryPrompt: string;
      nonPrimeUser: string;
      nonPrimeSystem: string;
      model: string;
      temperature: number;
      top_p: number;
    };
  };
  cases: {
    mode: ('sf' | 'zendesk')[];
  };
  kontentProjectId: string;
  kontentProxyUrl: string;
  kontentManagementApiKey: string;
  kontentPreviewApiKey: string;
  kontentWebhookSecret: string;
  candidateRemovalSecretKey: string;
}
