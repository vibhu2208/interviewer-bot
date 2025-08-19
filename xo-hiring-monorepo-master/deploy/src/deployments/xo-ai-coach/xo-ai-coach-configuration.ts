import {
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
import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { ProjectName } from '../../config/environments';
import { PROJECT_ROOT_PATH } from '../../config/paths';

export const XoAiCoachProjectName = 'xo-ai-coach';
export const XoAiCoachBackendStackName = 'xo-ai-coach-backend';
export const XoAiCoachLambdaProject = path.resolve(PROJECT_ROOT_PATH, 'xo-ai-coach');

export interface XoAiCoachConfiguration {
  removalPolicy: RemovalPolicy;
  logRetention: RetentionDays;
  xoManageIntegrationUserSecret: string;
  mailosaurSecretName: string;
  mockEmails: boolean;
  athenaDbName: string;
  athenaTableName: string;
  sourceBucketArn: string;
  emailIdentity: string;
  sesConfigurationSet: string;
  isPreviewEnvironment: boolean;
}

@Configuration(XoAiCoachProjectName, 'production')
export class XoAiCoachConfigurationProduction implements Configurator<XoAiCoachConfiguration> {
  config(): XoAiCoachConfiguration {
    return {
      removalPolicy: RemovalPolicy.RETAIN,
      logRetention: RetentionDays.FOUR_MONTHS,
      xoManageIntegrationUserSecret: 'xo-hiring/integration/production/xo-manage',
      athenaDbName: 'xo-ai-coach-data',
      athenaTableName: 'user_activity_production',
      sourceBucketArn: 'arn:aws:s3:::xo-ai-coach-production-external',
      mailosaurSecretName: 'xo-hiring/integration/sandbox/mailosaur',
      emailIdentity: 'arn:aws:ses:us-east-1:104042860393:identity/noreply@crossover.com',
      mockEmails: false,
      sesConfigurationSet: 'xo-hiring-production-ai-coach',
      isPreviewEnvironment: false,
    };
  }
}

@Configuration(XoAiCoachProjectName, 'sandbox')
export class XoAiCoachConfigurationSandbox implements Configurator<XoAiCoachConfiguration> {
  config(): XoAiCoachConfiguration {
    return {
      removalPolicy: RemovalPolicy.DESTROY,
      logRetention: RetentionDays.ONE_WEEK,
      xoManageIntegrationUserSecret: 'xo-hiring/integration/sandbox/xo-manage',
      athenaDbName: 'xo-ai-coach-data',
      athenaTableName: 'user_activity_production', // We can use production here as well, it's read-only and output into mailosaur
      sourceBucketArn: 'arn:aws:s3:::xo-ai-coach-production-external',
      mailosaurSecretName: 'xo-hiring/integration/sandbox/mailosaur',
      emailIdentity: 'arn:aws:ses:us-east-1:104042860393:identity/noreply@crossover.com',
      mockEmails: true,
      sesConfigurationSet: 'xo-hiring-sandbox-ai-coach',
      isPreviewEnvironment: false,
    };
  }
}

@Configuration(XoAiCoachProjectName)
export class XoAiCoachConfigurationTemp extends XoAiCoachConfigurationSandbox {
  config(): XoAiCoachConfiguration {
    return {
      ...super.config(),
      isPreviewEnvironment: true,
    };
  }
}

@Prepare(XoAiCoachProjectName)
export class PrepareProject implements PrepareCallback {
  async invoke(config: PrepareConfig): Promise<void> {
    const buildResult = LambdaBuilders.prepareNpmTsProject(XoAiCoachLambdaProject, config);

    if (!buildResult) {
      throw new Error('prepareNpmTsProject result is not successful.');
    }
  }
}

@AfterDestruction(XoAiCoachProjectName)
export class AfterDestructionLogic implements InfraCallback<XoAiCoachConfiguration> {
  async invoke(env: string, config: XoAiCoachConfiguration): Promise<void> {
    // Remove all SSM parameters for the preview environment on destroy
    if (config.isPreviewEnvironment) {
      console.log(`Dropping all SSM parameters for env: ${env}`);
      const preview = new SsmEditor({ productName: ProjectName, environment: env });
      await preview.dropAll();
    }
  }
}
