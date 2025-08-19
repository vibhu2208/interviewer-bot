import { LambdaBuilders, Prepare, PrepareCallback, PrepareConfig } from '@trilogy-group/lambda-cdk-infra';
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
    // Prepare lambda distribution, for the TS project it will be under dist/code and dist/layer
    if (!LambdaBuilders.prepareNpmTsProject(project.path, config)) {
      throw new Error('sf-api PrepareProject has failed');
    }
  };
}
