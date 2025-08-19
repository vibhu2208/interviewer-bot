import type { Configurator } from '@trilogy-group/lambda-cdk-infra';
import { Configuration } from '@trilogy-group/lambda-cdk-infra';
import { PreviewEnvName, ProductionEnvName, SandEnvName } from '../../config/environments';
import { Projects } from '../../config/projects';

export const project = Projects['watcher'];

export type WatcherConfig = {
  subscriptions: string[];
};

@Configuration(project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<WatcherConfig> {
  config(): WatcherConfig {
    return {
      subscriptions: ['xo-hiring-cicd-failures'],
    };
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfig implements Configurator<WatcherConfig> {
  config(): WatcherConfig {
    return {
      subscriptions: [],
    };
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfig implements Configurator<WatcherConfig> {
  config(): WatcherConfig {
    return {
      subscriptions: [],
    };
  }
}
