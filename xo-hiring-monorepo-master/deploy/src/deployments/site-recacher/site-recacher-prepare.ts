import { Prepare, PrepareCallback, PrepareConfig } from '@trilogy-group/lambda-cdk-infra';
import { ExecException, execSync } from 'child_process';
import { project } from './site-recacher-config';

/**
 * This code will be invoked before the deployment to prepare all backend-related distributions
 * We will prepare our TS lambda project here
 */
@Prepare(project.name)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class PrepareProject implements PrepareCallback {
  invoke = async (config: PrepareConfig): Promise<void> => {
    exec('. ./docker-push.sh', project.path, config.debug);
  };
}

/**
 * Copied from github.com/trilogy-group/lambda-cdk-infra/blob/c2544b6d64f5a6f3e3096901ce3325f4bb376252/src/lambda-builders.ts
 * Execute any command in the given folder
 * @param command cmd command
 * @param basePath execution directory
 * @param showOutput true if we want to show output
 */
function exec(command: string, basePath: string, showOutput = true): void {
  try {
    execSync(command, {
      cwd: basePath,
      stdio: showOutput ? 'inherit' : 'ignore',
    });
  } catch (err) {
    console.error(`Command '${command}' at '${basePath}' finished with status code ${(err as ExecException).code}`);
    throw err;
  }
}
