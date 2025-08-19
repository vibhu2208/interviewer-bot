import type { Configurator } from '@trilogy-group/lambda-cdk-infra';
import { Configuration } from '@trilogy-group/lambda-cdk-infra';
import { PreviewEnvName, ProductionEnvName, SandEnvName } from '../../config/environments';
import { Projects } from '../../config/projects';

export const project = Projects['uploadavatar'];

export type UploadAvatarConfig = {
  bucketName: string;
};

@Configuration(project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<UploadAvatarConfig> {
  config(): UploadAvatarConfig {
    return {
      bucketName: 'xo-hire-uploads',
    };
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfig implements Configurator<UploadAvatarConfig> {
  config(): UploadAvatarConfig {
    return {
      bucketName: 'xo-hire-uploads-dev',
    };
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfig extends SandboxConfig {
  config(): UploadAvatarConfig {
    return {
      ...super.config(),
    };
  }
}
