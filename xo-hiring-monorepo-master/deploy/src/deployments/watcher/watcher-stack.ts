import { AWSAccount, AWSRegion, generateStackResourceName } from '../../config/environments';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as util from '@aws-sdk/util-arn-parser';
import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { project, WatcherConfig } from './watcher-config';

@Deployment(project.name, project.name)
export class WatcherStack extends RootStack {
  constructor(stackConfig: StackConfig, envConfig: WatcherConfig) {
    super(stackConfig);

    // Create lambda layer with node_modules
    const layerPath = path.resolve(project.path, 'dist/layer');
    const codePath = path.resolve(project.path, 'dist/code');
    const modulesLayer = new LayerVersion(this, 'node_modules_layer', {
      code: Code.fromAsset(layerPath),
      compatibleRuntimes: [Runtime.NODEJS_16_X],
    });

    const func = new lambda.Function(this, 'func', {
      functionName: generateStackResourceName(stackConfig, 'func'),
      runtime: Runtime.NODEJS_16_X,
      handler: 'index.handler',
      layers: [modulesLayer],
      code: Code.fromAsset(codePath),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        ENV: stackConfig.environmentName,
      },
    });

    for (const topicName of envConfig.subscriptions) {
      const topic = sns.Topic.fromTopicArn(
        this,
        `s-${topicName}`,
        util.build({
          service: 'sns',
          region: AWSRegion,
          accountId: AWSAccount,
          resource: topicName,
        }),
      );

      topic.addSubscription(new subscriptions.LambdaSubscription(func));
    }

    func.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['*'],
        resources: [
          util.build({
            service: 'ssm',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `parameter/xo-hiring/*`,
          }),
        ],
      }),
    );
  }
}
