import type { Configurator } from '@trilogy-group/lambda-cdk-infra';
import { Configuration } from '@trilogy-group/lambda-cdk-infra';
import { PreviewEnvName, ProductionEnvName, SandEnvName } from '../../config/environments';
import { Projects } from '../../config/projects';

export const project = Projects['site-recacher'];

export interface SiteRecacherConfig {
  /**
   * Execution configuration for AWS ECS Fargate Task
   */
  fargateConfig: {
    vpcId: string;
    memoryLimitMiB: number;
    cpu: number;
  };
}

const DefaultSiteRecacherConfig = {
  fargateConfig: {
    vpcId: 'vpc-490ec62c',
    memoryLimitMiB: 1024,
    cpu: 512,
  },
};

@Configuration(project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<SiteRecacherConfig> {
  config(): SiteRecacherConfig {
    return {
      fargateConfig: {
        ...DefaultSiteRecacherConfig.fargateConfig,
        memoryLimitMiB: 4096,
        cpu: 2048,
      },
    };
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfig implements Configurator<SiteRecacherConfig> {
  config(): SiteRecacherConfig {
    return {
      ...DefaultSiteRecacherConfig,
    };
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfig extends SandboxConfig {}
