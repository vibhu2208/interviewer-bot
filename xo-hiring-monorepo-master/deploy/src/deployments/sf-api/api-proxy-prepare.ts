import { LambdaBuilders, Prepare, PrepareCallback, PrepareConfig } from '@trilogy-group/lambda-cdk-infra';
import * as fs from 'node:fs';
import * as fg from 'fast-glob';
import * as path from 'path';
import { PROJECT_ROOT_PATH } from '../../config/paths';
import { Projects } from '../../config/projects';

export const project = Projects['sf-api'];

/**
 * This code will be invoked before the deployment to prepare all backend-related distributions
 * We will prepare our TS lambda project here
 */
@Prepare(project.name)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class PrepareProject implements PrepareCallback {
  invoke = async (config: PrepareConfig): Promise<void> => {
    if (!LambdaBuilders.prepareNpmTsProject(path.join(PROJECT_ROOT_PATH, 'api-proxy'), config)) {
      throw new Error('api-proxy PrepareProject has failed');
    }

    // Remove all .ts and .md files from the lambda layer
    const layerPath = path.join(PROJECT_ROOT_PATH, 'api-proxy', 'dist/layer');
    const filesToRemove = await fg.glob(['**/*.ts', '**/*.md'], { cwd: layerPath });
    console.log(`Removing ${filesToRemove.length} files from the layer`);
    for (const file of filesToRemove) {
      const filePath = path.join(layerPath, file);
      fs.unlinkSync(filePath);
    }
  };
}
