import {
  Configuration,
  Configurator,
  LambdaBuilders,
  Prepare,
  PrepareCallback,
  PrepareConfig,
} from '@trilogy-group/lambda-cdk-infra';
import { RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { PROJECT_ROOT_PATH } from '../../config/paths';
import { EnvironmentType } from '../../utils/lambda-helpers';

export const SourcingManagerProjectName = 'sourcing-manager';
export const SourcingManagerBackendStackName = 'sourcing-manager-backend';
export const SourcingManagerLambdaProject = path.resolve(PROJECT_ROOT_PATH, 'packages/sourcing-manager');

export interface SourcingManagerConfiguration {
  deletionProtection: boolean;
  removalPolicy: RemovalPolicy;
  logRetention: RetentionDays;
  envType: EnvironmentType;
  indeed: {
    legacyBucketName: string;
    athenaAnalyticsBucket: string;
  };
  failureSnsTopic: string;
  sfPartnerEventSourceArn: string;
}

@Configuration(SourcingManagerProjectName, 'production')
export class SourcingManagerConfigurationProduction implements Configurator<SourcingManagerConfiguration> {
  config(): SourcingManagerConfiguration {
    return {
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      logRetention: RetentionDays.TWO_YEARS,
      envType: EnvironmentType.Production,
      indeed: {
        legacyBucketName: 'crossover-indeed',
        athenaAnalyticsBucket: 'xo-hiring-production-stats-tracker-ownbackup-bucket',
      },
      failureSnsTopic: 'xo-hire-failures',
      sfPartnerEventSourceArn:
        'arn:aws:events:us-east-1::event-source/aws.partner/salesforce.com/00D0o000000RR1aEAG/0YLIj000000XZAHOA4',
    };
  }
}

@Configuration(SourcingManagerProjectName, 'sandbox')
export class SourcingManagerConfigurationSandbox implements Configurator<SourcingManagerConfiguration> {
  config(): SourcingManagerConfiguration {
    return {
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      logRetention: RetentionDays.ONE_MONTH,
      envType: EnvironmentType.Sandbox,
      indeed: {
        legacyBucketName: 'crossover-indeed-sandbox',
        athenaAnalyticsBucket: 'xo-hiring-sandbox-stats-tracker-ownbackup-bucket',
      },
      failureSnsTopic: 'xo-hiring-sandbox-failures',
      sfPartnerEventSourceArn:
        'arn:aws:events:us-east-1::event-source/aws.partner/salesforce.com/00D0l000000HHxjEAG/0YLC100000001QjOAI',
    };
  }
}

@Configuration(SourcingManagerProjectName)
export class SourcingManagerConfigurationTemp extends SourcingManagerConfigurationSandbox {
  config(): SourcingManagerConfiguration {
    return {
      ...super.config(),
      envType: EnvironmentType.Preview,
    };
  }
}

@Prepare(SourcingManagerProjectName)
export class PrepareProject implements PrepareCallback {
  async invoke(config: PrepareConfig): Promise<void> {
    const buildResult = LambdaBuilders.prepareNpmTsProject(SourcingManagerLambdaProject, config);

    if (!buildResult) {
      throw new Error('prepareNpmTsProject result is not successful.');
    }
  }
}
