import type { Configurator, PrepareCallback, PrepareConfig } from '@trilogy-group/lambda-cdk-infra';
import { Configuration, LambdaBuilders, Prepare } from '@trilogy-group/lambda-cdk-infra';
import { EnvironmentConfiguration } from '../../config/model';
import {
  PreviewEnvName,
  ProdEnvConfig,
  ProductionEnvName,
  SandEnvConfig,
  SandEnvName,
} from '../../config/environments';
import { Projects } from '../../config/projects';

export const project = Projects['terminated-partners'];

/**
 * This code will be invoked before the deployment to prepare all backend-related distributions
 * We will prepare our TS lambda project here
 */
@Prepare(project.name)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class PrepareProject implements PrepareCallback {
  invoke = async (config: PrepareConfig): Promise<void> => {
    // Prepare lambda distribution, for the TS project it will be under dist/code and dist/layer
    LambdaBuilders.prepareNpmTsProject(project.path, config);
  };
}

@Configuration(project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<EnvironmentConfiguration> {
  config(): EnvironmentConfiguration {
    return ProdEnvConfig;
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfig implements Configurator<EnvironmentConfiguration> {
  config(): EnvironmentConfiguration {
    return SandEnvConfig;
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfig implements Configurator<EnvironmentConfiguration> {
  config(): EnvironmentConfiguration {
    return ProdEnvConfig;
  }
}
