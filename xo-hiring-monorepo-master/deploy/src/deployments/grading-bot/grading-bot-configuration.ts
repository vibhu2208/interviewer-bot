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

export const GradingBotProjectName = 'grading-bot';
export const GradingBotBackendStackName = 'grading-bot-backend';
export const GradingBotLambdaProject = path.resolve(PROJECT_ROOT_PATH, 'grading-bot');
export const DynamoDbTableNameOutput = 'DynamoDbTableNameOutput';
export const RestApiUrl = 'RestApiUrl';

export interface GradingBotConfiguration {
  deletionProtection: boolean;
  removalPolicy: RemovalPolicy;
  logRetention: RetentionDays;
  restApiDomainName: (env: string) => string;
  domainCertificateArn: string;
  hostedZone: string;
  athenaDb: string;
  athenaResultBucket: string;
  athenaSourceBucket: string;
  googleCredentialsSecretName: string;
  isPreviewEnvironment: boolean;
  openaiSecretName: string;
}

@Configuration(GradingBotProjectName, 'production')
export class GradingBotConfigurationProduction implements Configurator<GradingBotConfiguration> {
  config(): GradingBotConfiguration {
    return {
      deletionProtection: true,
      isPreviewEnvironment: false,
      removalPolicy: RemovalPolicy.RETAIN,
      logRetention: RetentionDays.FOUR_MONTHS,
      restApiDomainName: () => `grading-api-rest.crossover.com`,
      domainCertificateArn: 'arn:aws:acm:us-east-1:104042860393:certificate/4665a8b4-c8c2-4a62-932a-32235a02cb05',
      hostedZone: 'crossover.com',
      athenaDb: 'xo-hiring-production-stats-tracker-backup',
      athenaResultBucket: 'xo-production-athena-query-results',
      athenaSourceBucket: 'xo-hiring-production-stats-tracker-ownbackup-bucket',
      googleCredentialsSecretName: 'xo-hiring/grading-bot/google-service-user',
      openaiSecretName: 'xo-hiring/integration/production/openai',
    };
  }
}

@Configuration(GradingBotProjectName, 'sandbox')
export class GradingBotConfigurationSandbox implements Configurator<GradingBotConfiguration> {
  config(): GradingBotConfiguration {
    return {
      deletionProtection: false,
      isPreviewEnvironment: false,
      removalPolicy: RemovalPolicy.DESTROY,
      logRetention: RetentionDays.ONE_WEEK,
      restApiDomainName: (env) => `${env}-grading-api-rest.crossover.com`,
      domainCertificateArn: 'arn:aws:acm:us-east-1:104042860393:certificate/4665a8b4-c8c2-4a62-932a-32235a02cb05',
      hostedZone: 'crossover.com',
      athenaDb: 'xo-hiring-sandbox-stats-tracker-backup',
      athenaResultBucket: 'xo-sandbox-athena-query-results',
      athenaSourceBucket: 'xo-hiring-sandbox-stats-tracker-ownbackup-bucket',
      googleCredentialsSecretName: 'xo-hiring/grading-bot/google-service-user',
      openaiSecretName: 'xo-hiring/integration/sandbox/openai',
    };
  }
}

@Configuration(GradingBotProjectName)
export class GradingBotConfigurationTemp extends GradingBotConfigurationSandbox {
  config(): GradingBotConfiguration {
    return {
      ...super.config(),
      isPreviewEnvironment: true,
    };
  }
}

@Prepare(GradingBotProjectName)
export class PrepareProject implements PrepareCallback {
  async invoke(config: PrepareConfig): Promise<void> {
    const buildResult = LambdaBuilders.prepareNpmTsProject(GradingBotLambdaProject, config);

    if (!buildResult) {
      throw new Error('prepareNpmTsProject result is not successful.');
    }
  }
}

@AfterDestruction(GradingBotProjectName)
export class AfterDestructionLogic implements InfraCallback<GradingBotConfiguration> {
  async invoke(env: string, config: GradingBotConfiguration): Promise<void> {
    // Remove all SSM parameters for the preview environment on destroy
    if (config.isPreviewEnvironment) {
      console.log(`Dropping all SSM parameters for env: ${env}`);
      const preview = new SsmEditor({ productName: ProjectName, environment: env });
      await preview.dropAll();
    }
  }
}
