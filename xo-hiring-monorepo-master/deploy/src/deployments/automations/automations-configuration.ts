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
import { Projects } from '../../config/projects';
import { EnvironmentType } from '../../utils/lambda-helpers';

export const AutomationsProjectName = 'automations';
export const AutomationsBackendStackName = 'automations-backend';
export const AutomationsLambdaProject = Projects['automations'].path;

export interface AutomationsConfiguration {
  deletionProtection: boolean;
  removalPolicy: RemovalPolicy;
  logRetention: RetentionDays;
  envType: EnvironmentType;
  failureSnsTopic: string;
  escalationConfigParam: string;
}

@Configuration(AutomationsProjectName, 'production')
export class AutomationsConfigurationProduction implements Configurator<AutomationsConfiguration> {
  config(): AutomationsConfiguration {
    return {
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      logRetention: RetentionDays.TWO_YEARS,
      envType: EnvironmentType.Production,
      failureSnsTopic: 'xo-hire-failures',
      escalationConfigParam: '/xo-hiring/production/automations/grading-escalation-config',
    };
  }
}

@Configuration(AutomationsProjectName, 'sandbox')
export class AutomationsConfigurationSandbox implements Configurator<AutomationsConfiguration> {
  config(): AutomationsConfiguration {
    return {
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      logRetention: RetentionDays.ONE_MONTH,
      envType: EnvironmentType.Sandbox,
      failureSnsTopic: 'xo-hiring-sandbox-failures',
      escalationConfigParam: '/xo-hiring/sandbox/automations/grading-escalation-config',
    };
  }
}

@Configuration(AutomationsProjectName)
export class AutomationsConfigurationTemp extends AutomationsConfigurationSandbox {
  config(): AutomationsConfiguration {
    return {
      ...super.config(),
      envType: EnvironmentType.Preview,
    };
  }
}

@Prepare(AutomationsProjectName)
export class PrepareProject implements PrepareCallback {
  async invoke(config: PrepareConfig): Promise<void> {
    const buildResult = LambdaBuilders.prepareNpmTsProject(AutomationsLambdaProject, config);

    if (!buildResult) {
      throw new Error('prepareNpmTsProject result is not successful.');
    }
  }
}
