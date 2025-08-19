import {
  AfterDeployment,
  AfterDestruction,
  Configuration,
  Configurator,
  InfraCallback,
  LambdaBuilders,
  Prepare,
  PrepareCallback,
  PrepareConfig,
} from '@trilogy-group/lambda-cdk-infra';
import { SsmEditor } from '@trilogy-group/xo-hiring-parameters';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { PROJECT_ROOT_PATH } from '../../config/paths';

export const BfqVerificationProjectName = 'bfq-verification';
export const BfqVerificationBackendStackName = 'bfq-verification-backend';
export const LambdaProject = path.resolve(PROJECT_ROOT_PATH, 'bfq-verification');

const SsmProductName = 'xo-hiring-bfq-verification';

export interface BfqVerificationConfiguration {
  eventBridgeScheduleExpression: string;
  eventBridgeEnabled: boolean;
  logRetention: RetentionDays;
  jiraDryRun: boolean;
  jiraUserSecretName: string;
  isPreview: boolean;
}

const SharedConfiguration: BfqVerificationConfiguration = {
  eventBridgeScheduleExpression: 'cron(45 12,00 * * ? *)',
  eventBridgeEnabled: false,
  logRetention: RetentionDays.ONE_WEEK,
  jiraDryRun: true,
  jiraUserSecretName: 'xo-hiring/bfq-verification/jira-user',
  isPreview: false,
};

@Configuration(BfqVerificationProjectName, 'production')
export class BfqVerificationConfigurationProduction implements Configurator<BfqVerificationConfiguration> {
  config(): BfqVerificationConfiguration {
    return {
      ...SharedConfiguration,
      eventBridgeEnabled: true,
      logRetention: RetentionDays.FOUR_MONTHS,
      jiraDryRun: false,
    };
  }
}

@Configuration(BfqVerificationProjectName, 'sandbox')
export class BfqVerificationConfigurationSandbox implements Configurator<BfqVerificationConfiguration> {
  config(): BfqVerificationConfiguration {
    return {
      ...SharedConfiguration,
    };
  }
}

@Configuration(BfqVerificationProjectName)
export class BfqVerificationConfigurationTemp implements Configurator<BfqVerificationConfiguration> {
  config(): BfqVerificationConfiguration {
    return {
      ...SharedConfiguration,
      isPreview: true,
    };
  }
}

@Prepare(BfqVerificationProjectName)
export class PrepareProject implements PrepareCallback {
  async invoke(config: PrepareConfig): Promise<void> {
    const buildResult = LambdaBuilders.prepareNpmTsProject(LambdaProject, config);

    if (!buildResult) {
      throw new Error('prepareNpmTsProject result is not successful.');
    }
  }
}

@AfterDeployment(BfqVerificationProjectName)
export class AfterDeploymentLogic implements InfraCallback<BfqVerificationConfiguration> {
  async invoke(env: string, config: BfqVerificationConfiguration): Promise<void> {
    // For persistent envs we're supposed to fill the values manually
    // For preview envs we will copy them from the sandbox env
    if (config.isPreview) {
      console.log(`Copying SSM parameters for env: ${env} from sandbox`);
      const sandbox = new SsmEditor({ productName: SsmProductName, environment: 'sandbox' });
      const preview = new SsmEditor({ productName: SsmProductName, environment: env });
      await sandbox.copy(preview);
    }
  }
}

@AfterDestruction(BfqVerificationProjectName)
export class AfterDestructionLogic implements InfraCallback<BfqVerificationConfiguration> {
  async invoke(env: string, config: BfqVerificationConfiguration): Promise<void> {
    // Remove all SSM parameters for the preview environment on destroy
    if (config.isPreview) {
      console.log(`Dropping all SSM parameters for env: ${env}`);
      const preview = new SsmEditor({ productName: SsmProductName, environment: env });
      await preview.dropAll();
    }
  }
}
