import { Infra } from '@trilogy-group/lambda-cdk-infra';
import * as path from 'path';
import { ProjectName } from './config/environments';

(async () => {
  await Infra.scanPath(path.resolve(__dirname, 'deployments'));
  await Infra.initialize({
    projectName: ProjectName,
    entryPoint: __filename,
    owner: 'dragos.nuta@aurea.com',
    ownerTagProps: {
      // LAMBDA-60758: Do not tag OS collection to resolve the resource update problem
      excludeResourceTypes: ['AWS::OpenSearchServerless::Collection'],
    },
  });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
