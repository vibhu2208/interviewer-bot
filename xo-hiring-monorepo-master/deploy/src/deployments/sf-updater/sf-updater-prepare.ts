import { LambdaBuilders, Prepare, PrepareCallback, PrepareConfig } from '@trilogy-group/lambda-cdk-infra';
import { Projects } from '../../config/projects';
import * as path from 'path';
import { PROJECT_ROOT_PATH } from '../../config/paths';

export const project = Projects['sf-updater'];

/**
 * This code will be invoked before the deployment to prepare all backend-related distributions
 * We will prepare our TS lambda project here
 */
@Prepare(project.name)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class PrepareProject implements PrepareCallback {
  invoke = async (config: PrepareConfig): Promise<void> => {
    LambdaBuilders.prepareNpmTsProject(path.join(PROJECT_ROOT_PATH, 's3-cleanup'), { ...config, prepareLayer: false });
    LambdaBuilders.prepareNpmTsProject(path.join(PROJECT_ROOT_PATH, 's3-csv-split'), {
      ...config,
      prepareLayer: false,
    });
  };
}
