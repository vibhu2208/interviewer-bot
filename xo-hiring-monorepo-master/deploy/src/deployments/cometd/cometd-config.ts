import type { Configurator } from '@trilogy-group/lambda-cdk-infra';
import { Configuration } from '@trilogy-group/lambda-cdk-infra';
import { DefaultDnsConfig, PreviewEnvName, ProductionEnvName, SandEnvName } from '../../config/environments';
import { DnsConfig } from '../../config/model';
import { Projects } from '../../config/projects';

export const project = Projects['cometd'];

export type CometdConfig = {
  salesforceDomainName: string;
  crossoverDomainName: string;
  serviceUserSecretName: string;
  dns?: DnsConfig;
};

@Configuration(project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<CometdConfig> {
  config(): CometdConfig {
    return {
      salesforceDomainName: 'crossover.my.salesforce.com',
      crossoverDomainName: 'crossover.com',
      serviceUserSecretName: 'xo-hiring-admin-production/service-user',
      dns: {
        ...DefaultDnsConfig,
        cnameRecordName: 'cometd.crossover.com',
      },
    };
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfig implements Configurator<CometdConfig> {
  config(): CometdConfig {
    return {
      salesforceDomainName: 'crossover--fullshared.sandbox.my.salesforce.com',
      crossoverDomainName: 'sandbox-profile.crossover.com',
      serviceUserSecretName: 'xo-hiring-admin-sand/service-user',
      dns: {
        ...DefaultDnsConfig,
        cnameRecordName: 'sandbox-cometd.crossover.com',
      },
    };
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfig extends SandboxConfig {
  config(): CometdConfig {
    return {
      ...super.config(),
      dns: undefined,
    };
  }
}
