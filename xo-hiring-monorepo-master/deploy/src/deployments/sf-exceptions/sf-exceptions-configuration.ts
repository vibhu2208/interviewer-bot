import {
  Configuration,
  Configurator,
  LambdaBuilders,
  Prepare,
  PrepareCallback,
  PrepareConfig,
} from '@trilogy-group/lambda-cdk-infra';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { PROJECT_ROOT_PATH } from '../../config/paths';

export const SfExceptionsProjectName = 'sf-exceptions';
export const SfExceptionsBackendStackName = 'sf-exceptions-backend';
export const SfExceptionsLambdaProject = path.resolve(PROJECT_ROOT_PATH, 'sf-exceptions-proxy');

export interface SfExceptionsConfiguration {
  removalPolicy: RemovalPolicy;
  logRetention: RetentionDays;
  mxRecordName: (env: string) => string;
  alarmActionsEnabled: boolean;
  alarmNotificationTarget: string;
  metricsPeriod: Duration;
}

@Configuration(SfExceptionsProjectName, 'production')
export class SfExceptionsConfigurationProduction implements Configurator<SfExceptionsConfiguration> {
  config(): SfExceptionsConfiguration {
    return {
      removalPolicy: RemovalPolicy.RETAIN,
      logRetention: RetentionDays.SIX_MONTHS,
      mxRecordName: () => 'sf-exceptions.crossover.com',
      alarmActionsEnabled: true,
      alarmNotificationTarget: 'arn:aws:sns:us-east-1:104042860393:xo-hire-failures',
      metricsPeriod: Duration.minutes(10),
    };
  }
}

@Configuration(SfExceptionsProjectName)
export class SfExceptionsConfigurationTemp implements Configurator<SfExceptionsConfiguration> {
  config(): SfExceptionsConfiguration {
    return {
      removalPolicy: RemovalPolicy.DESTROY,
      logRetention: RetentionDays.ONE_MONTH,
      mxRecordName: (env) => `sf-exceptions-${env}.crossover.com`,
      alarmActionsEnabled: false,
      alarmNotificationTarget: 'arn:aws:sns:us-east-1:104042860393:xo-hire-failures',
      metricsPeriod: Duration.minutes(10),
    };
  }
}

@Prepare(SfExceptionsProjectName)
export class PrepareProject implements PrepareCallback {
  async invoke(config: PrepareConfig): Promise<void> {
    const buildResult = LambdaBuilders.prepareNpmTsProject(SfExceptionsLambdaProject, config);

    if (!buildResult) {
      throw new Error('prepareNpmTsProject result is not successful.');
    }
  }
}
