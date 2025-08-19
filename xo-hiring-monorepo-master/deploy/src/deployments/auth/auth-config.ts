import {
  Configuration,
  Configurator,
  Prepare,
  PrepareCallback,
  LambdaBuilders,
  PrepareConfig,
} from '@trilogy-group/lambda-cdk-infra';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fg from 'fast-glob';
import { PreviewEnvName, ProductionEnvName, SandEnvName } from '../../config/environments';
import { Projects } from '../../config/projects';

export const project = Projects['auth'];

const DefaultAuthConfig = {
  trustedSources: ['Easy Apply', 'Indeed Job Post'],
  googleOAuthSecretName: 'xo-hiring/integration/production/candidate-google-oauth',
  linkedinOAuthSecretName: 'xo-hiring/integration/production/candidate-linkedin-oauth',
};

export type AuthConfig = {
  distributionId: string;
  trustedSources: string[];
  googleOAuthSecretName: string;
  linkedinOAuthSecretName: string;
  frontendCandidateDomains: string[];
  userInfoProxyUrl: string;
  cognitoDomain: (env: string) => string | null;
};

@Configuration(project.name, ProductionEnvName)
export class ProductionConfig implements Configurator<AuthConfig> {
  config(): AuthConfig {
    return {
      ...DefaultAuthConfig,
      distributionId: 'E1UWD27F67W5EW',
      frontendCandidateDomains: ['https://crossover.com', 'https://www.crossover.com'],
      userInfoProxyUrl: 'https://profile-api.crossover.com/sso',
      cognitoDomain: () => `auth.crossover.com`,
    };
  }
}

@Configuration(project.name, SandEnvName)
export class SandboxConfig implements Configurator<AuthConfig> {
  config(): AuthConfig {
    return {
      ...DefaultAuthConfig,
      distributionId: 'E37PCX1Y3EBNHF',
      frontendCandidateDomains: ['https://sandbox-profile.crossover.com', 'http://localhost:4200'],
      userInfoProxyUrl: 'https://sandbox-profile-api.crossover.com/sso',
      cognitoDomain: () => `sandbox-auth.crossover.com`,
    };
  }
}

@Configuration(project.name, PreviewEnvName)
export class PreviewConfig extends SandboxConfig {
  config(): AuthConfig {
    return {
      ...super.config(),
      cognitoDomain: () => null,
    };
  }
}

@Prepare(project.name)
export class PrepareProject implements PrepareCallback {
  invoke = async (config: PrepareConfig): Promise<void> => {
    const buildResult = LambdaBuilders.prepareNpmTsProject(project.path, config);

    if (buildResult) {
      // Remove all .ts and .md files from the lambda layer
      const layerPath = path.join(project.path, 'dist/layer');
      const filesToRemove = await fg.glob(['**/*.ts', '**/*.md'], { cwd: layerPath });

      for (const file of filesToRemove) {
        const filePath = path.join(layerPath, file);
        fs.unlinkSync(filePath);
      }
    }

    if (!buildResult) {
      throw new Error('prepareNpmTsProject result is not successful.');
    }
  };
}
