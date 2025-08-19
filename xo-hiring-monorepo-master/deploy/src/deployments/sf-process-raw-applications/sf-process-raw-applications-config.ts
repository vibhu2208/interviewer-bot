import type { Configurator } from '@trilogy-group/lambda-cdk-infra';
import { Configuration } from '@trilogy-group/lambda-cdk-infra';
import { PreviewEnvName, ProductionEnvName, SandEnvName } from '../../config/environments';
import { Projects } from '../../config/projects';

export const project = Projects['sf-process-raw-applications'];

const DefaultConfig = {
  getSsmParameterPrefixes: (envName: string) => [`/xo-hiring/${envName}/sf-process-raw-applications`],
  getSsmServiceAccountParameter: (envName: string) => [`/xo-hiring/${envName}/common/salesforce-service-account`],
};

export type Config = {
  getSsmParameterPrefixes: (envName: string) => string[];
  getSsmServiceAccountParameter: (envName: string) => string[];
  failureSNSArn?: string;
};

@Configuration(project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<Config> {
  config(): Config {
    return {
      failureSNSArn: 'arn:aws:sns:us-east-1:104042860393:xo-hire-failures',
      ...DefaultConfig,
    };
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfig implements Configurator<Config> {
  config(): Config {
    return {
      failureSNSArn: 'arn:aws:sns:us-east-1:104042860393:xo-hiring-sandbox-failures',
      ...DefaultConfig,
    };
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfig implements Configurator<Config> {
  config(): Config {
    // for previews, use sandbox as a fallback value
    return {
      getSsmParameterPrefixes: (envName: string) => [
        `/xo-hiring/${envName}/sf-process-raw-applications`,
        '/xo-hiring/sandbox/sf-process-raw-applications',
      ],
      getSsmServiceAccountParameter: (envName: string) => [
        `/xo-hiring/${envName}/common/salesforce-service-account`,
        '/xo-hiring/sandbox/common/salesforce-service-account',
      ],
      failureSNSArn: 'arn:aws:sns:us-east-1:104042860393:xo-hiring-sandbox-failures',
    };
  }
}
