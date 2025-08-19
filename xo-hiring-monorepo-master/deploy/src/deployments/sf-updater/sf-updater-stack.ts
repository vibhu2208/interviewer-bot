import * as path from 'path';
import * as fs from 'fs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { project, SfUpdaterConfig } from './sf-updater-config';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Source } from 'aws-cdk-lib/aws-s3-deployment';
import { generateStackResourceName } from '../../config/environments';
import { SfUpdaterStateMachineStack } from './sf-updater-state-machine-stack';
import { PROJECT_ROOT_PATH } from '../../config/paths';

@Deployment(project.name, project.name)
export class SfUpdaterStack extends RootStack {
  stateMachineStacks: SfUpdaterStateMachineStack[] = [];

  constructor(config: StackConfig, env: SfUpdaterConfig) {
    super(config);

    // since this bucket is used only for input, no need to keep it
    const bucket = new s3.Bucket(this, 'input', {
      bucketName: generateStackResourceName(config, 'input'),
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    bucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:*'],
        resources: [bucket.bucketArn, bucket.arnForObjects('*')],
        principals: [new ServicePrincipal('appflow.amazonaws.com')],
      }),
    );

    // optionally populate bucket with data from local folder
    const localSourcePath = path.resolve(project.path, env.localSourceFolder ?? '');
    if (env.localSourceFolder && fs.existsSync(localSourcePath)) {
      new s3deployment.BucketDeployment(this, 'input_data', {
        destinationBucket: bucket,
        sources: [Source.asset(localSourcePath)],
      });
    }

    // lambda for s3 bucket cleanup
    const cleanupFunc = new lambda.Function(this, 's3cleanup', {
      code: lambda.Code.fromAsset(path.resolve(PROJECT_ROOT_PATH, 's3-cleanup', 'dist/code')),
      functionName: generateStackResourceName(config, 's3cleanup'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: Duration.seconds(45),
    });
    bucket.grantRead(cleanupFunc);
    bucket.grantDelete(cleanupFunc);

    // lambda for splitting large CSV into parts (AppFlow has a limit of 128MB/file)
    const splitFunc = new lambda.Function(this, 's3csvsplit', {
      code: lambda.Code.fromAsset(path.resolve(PROJECT_ROOT_PATH, 's3-csv-split', 'dist/code')),
      functionName: generateStackResourceName(config, 's3csvsplit'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      timeout: Duration.seconds(60),
      memorySize: 1024,
    });
    bucket.grantReadWrite(splitFunc);
    bucket.grantDelete(splitFunc);

    // create a separate stack machine for every data update flow
    for (const flowName in env.flows) {
      const flowConfig = env.flows[flowName];
      const stateMachineStack = new SfUpdaterStateMachineStack(this, `stateMachineStack_${flowName}`, {
        connectorProfileName: env.salesforceConnectorProfileName,
        flowName: flowName,
        flowConfig: flowConfig,
        inputBucket: bucket,
        stackConfig: config,
        cleanupFunc: cleanupFunc,
        splitFunc: splitFunc,
      });
      bucket.grantReadWrite(stateMachineStack.stateMachine);

      this.stateMachineStacks.push(stateMachineStack);
    }
  }
}
