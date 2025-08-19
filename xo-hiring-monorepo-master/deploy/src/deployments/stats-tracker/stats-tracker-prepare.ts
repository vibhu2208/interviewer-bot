import { LambdaBuilders, Prepare, PrepareConfig } from '@trilogy-group/lambda-cdk-infra';
import { Project } from './config';
import { ProjectStructure } from './paths';

@Prepare(Project.name)
export class StatsTrackerPrepare {
  async invoke(config: PrepareConfig): Promise<void> {
    let buildResult = LambdaBuilders.prepareNpmTsProject(ProjectStructure.ownbackupExporterLambda, {
      ...config,
    });

    buildResult =
      buildResult &&
      LambdaBuilders.prepareNpmTsProject(ProjectStructure.trackerRefresherLambda, {
        ...config,
      });

    buildResult =
      buildResult &&
      LambdaBuilders.prepareNpmTsProject(ProjectStructure.kontentExporterLambda, {
        ...config,
      });

    if (!buildResult) {
      throw new Error('prepareNpmTsProject result is not successful.');
    }
  }
}
