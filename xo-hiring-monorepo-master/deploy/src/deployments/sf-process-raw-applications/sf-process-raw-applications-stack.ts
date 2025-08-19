import { AWSAccount, AWSRegion, generateStackResourceName, isPreview } from '../../config/environments';
import * as path from 'path';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as util from '@aws-sdk/util-arn-parser';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import { project, Config } from './sf-process-raw-applications-config';
import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { Schedule } from 'aws-cdk-lib/aws-events';
import { ssmPolicy } from '../../utils/lambda-helpers';

@Deployment(project.name, project.name)
export class SfProcessRawApplicationsStack extends RootStack {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(stackConfig: StackConfig, config: Config) {
    super(stackConfig);

    const layerPath = path.resolve(project.path, 'dist/layer');
    const codePath = path.resolve(project.path, 'dist/code');

    // failure topic

    const failureTopic = config.failureSNSArn
      ? sns.Topic.fromTopicArn(this, 'failure-topic', config.failureSNSArn)
      : undefined;

    // Create lambda layer with node_modules
    const modulesLayer = new LayerVersion(this, 'node_modules_layer', {
      code: Code.fromAsset(layerPath),
      compatibleRuntimes: [Runtime.NODEJS_16_X],
    });

    const func = new lambda.Function(this, 'func', {
      functionName: generateStackResourceName(stackConfig, 'func'),
      runtime: Runtime.NODEJS_16_X,
      handler: 'handler.handler',
      layers: [modulesLayer],
      code: Code.fromAsset(codePath),
      timeout: Duration.seconds(900),
      memorySize: 256,
      reservedConcurrentExecutions: 1,
      environment: {
        ENV: stackConfig.environmentName,
        SSM_PARAMETER_PREFIX: config.getSsmParameterPrefixes(stackConfig.environmentName).join(','),
        SSM_PARAMETER_SERVICE_ACCOUNT: config.getSsmServiceAccountParameter(stackConfig.environmentName).join(','),
      },
      onFailure: failureTopic ? new destinations.SnsDestination(failureTopic) : undefined,
    });

    func.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [
          ...config.getSsmParameterPrefixes(stackConfig.environmentName).map((prefix) =>
            util.build({
              service: 'ssm',
              region: AWSRegion,
              accountId: AWSAccount,
              resource: `parameter${prefix}/*`,
            }),
          ),
          ...config.getSsmServiceAccountParameter(stackConfig.environmentName).map((name) =>
            util.build({
              service: 'ssm',
              region: AWSRegion,
              accountId: AWSAccount,
              resource: `parameter${name}`,
            }),
          ),
        ],
        actions: ['*'],
      }),
    );

    func.addToRolePolicy(ssmPolicy(stackConfig.environmentName));

    if (!isPreview(stackConfig.environmentName)) {
      new events.Rule(this, 'rule', {
        targets: [new targets.LambdaFunction(func)],
        schedule: Schedule.rate(Duration.minutes(1)),
      });
    }
  }
}
