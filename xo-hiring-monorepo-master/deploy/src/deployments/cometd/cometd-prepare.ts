import type { PrepareCallback, PrepareConfig } from '@trilogy-group/lambda-cdk-infra';
import { LambdaBuilders, Prepare } from '@trilogy-group/lambda-cdk-infra';
import { Projects } from '../../config/projects';

export const project = Projects['cometd'];

/**
 * This code will be invoked before the deployment to prepare all backend-related distributions
 * We will prepare our TS lambda project here
 */
@Prepare(project.name)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class PrepareProject implements PrepareCallback {
  invoke = async (config: PrepareConfig): Promise<void> => {
    LambdaBuilders.prepareNpmTsProject(project.path, { ...config, prepareLayer: false });
  };
}
