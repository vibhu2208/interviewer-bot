import { LambdaBuilders, Prepare, PrepareCallback, PrepareConfig } from '@trilogy-group/lambda-cdk-infra';
import * as path from 'path';
import { PROJECT_ROOT_PATH } from '../../config/paths';
import { Project } from './config';

/**
 * This code will be invoked before the deployment to prepare all backend-related distributions
 * We will prepare our TS lambda project here
 */
@Prepare(Project.name)
export class PrepareProject implements PrepareCallback {
  invoke = async (config: PrepareConfig): Promise<void> => {
    if (!LambdaBuilders.prepareNpmTsProject(path.join(PROJECT_ROOT_PATH, 'open-search'), config)) {
      throw new Error('PrepareProject for open-search failed');
    }
  };
}
