import { LambdaBuilders, Prepare, PrepareCallback, PrepareConfig } from '@trilogy-group/lambda-cdk-infra';
import { project } from './sf-process-raw-applications-config';

/**
 * This code will be invoked before the deployment to prepare all backend-related distributions
 * We will prepare our TS lambda project here
 */
@Prepare(project.name)
export class PrepareProject implements PrepareCallback {
  invoke = async (config: PrepareConfig): Promise<void> => {
    LambdaBuilders.prepareNpmTsProject(project.path, config);
  };
}
