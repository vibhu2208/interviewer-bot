import type { Configurator } from '@trilogy-group/lambda-cdk-infra';
import { Configuration } from '@trilogy-group/lambda-cdk-infra';
import { DnsConfig } from '../../config/model';
import { DefaultDnsConfig, PreviewEnvName, ProductionEnvName, SandEnvName } from '../../config/environments';
import { Projects } from '../../config/projects';

export const project = Projects['kontent-api'];

export type KontentApiConfig = {
  dns?: DnsConfig;
};

@Configuration(project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<KontentApiConfig> {
  config(): KontentApiConfig {
    return {
      dns: {
        ...DefaultDnsConfig,
        cnameRecordName: 'kontent-proxy.crossover.com',
      },
    };
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfig implements Configurator<KontentApiConfig> {
  config(): KontentApiConfig {
    return {
      dns: {
        ...DefaultDnsConfig,
        cnameRecordName: 'sandbox-kontent-proxy.crossover.com',
      },
    };
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfig extends SandboxConfig {
  config(): KontentApiConfig {
    return {
      ...super.config(),
      dns: undefined,
    };
  }
}
