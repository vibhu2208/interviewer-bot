import { Bucket } from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

import { Duration, NestedStack, NestedStackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import { AWSAccount, AWSRegion, generateStackResourceName, isPreview, isProduction } from '../../config/environments';
import { DefaultInfraLambdaFunction, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Schedule } from 'aws-cdk-lib/aws-events';
import * as util from '@aws-sdk/util-arn-parser';
import { PROJECT_ROOT_PATH } from '../../config/paths';
import { ssmPolicy } from '../../utils/lambda-helpers';

// A fix for the issue with the lambda function runtime, where auto removal lambda function is created with runtime as NODEJS_14_X
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(DefaultInfraLambdaFunction as unknown as any)['runtime'] = Runtime.NODEJS_16_X;

const eventRules: { name: string; expression: string; disabled?: boolean }[] = [
  { name: 'LaunchLoadRawApplications', expression: 'rate(1 minute)' },
  { name: 'LIEALaunchLoadClosedJobs', expression: 'cron(5 * * * ? *)' },
  { name: 'LaunchProcessResumesBatchable', expression: 'rate(2 minutes)' },
  { name: 'LaunchLS_ProcessResumesBatchable', expression: 'rate(2 minutes)' },
  { name: 'LaunchLS_CreateRawAppsBatchable', expression: 'rate(5 minutes)' },
  { name: 'LaunchProcessCampaignMembership', expression: 'cron(0 0/5 * * ? *)', disabled: true },
  { name: 'LIEALoadJobsToCampaign', expression: 'cron(0/15 * * * ? *)' },
  { name: 'LISlotsLaunchAvgWeeklyApplicants', expression: 'cron(10 0/8 * * ? *)' },
  { name: 'PredictiveIndexTracker', expression: 'rate(1 hour)' },
  { name: 'CleanupPushEvent', expression: 'rate(3 hours)' },
  { name: 'CategoryJobApplicationBatchable', expression: 'rate(10 minutes)' },
];

export interface ActionCallerStackProps extends NestedStackProps {
  config: StackConfig;
  ssmParameters: {
    config: string[];
    serviceAccount: string[];
  };
  failureSnsTopic?: string;
  isPreview: boolean;
}

export class ActionCallerStack extends NestedStack {
  constructor(scope: Construct, id: string, props: ActionCallerStackProps) {
    super(scope, id, props);

    const projectPath = path.join(PROJECT_ROOT_PATH, 'sf-action-caller');
    const layerPath = path.resolve(projectPath, 'dist/layer');
    const codePath = path.resolve(projectPath, 'dist/code');
    // Create lambda layer with node_modules
    const modulesLayer = new lambda.LayerVersion(this, 'node_modules_layer', {
      code: Code.fromAsset(layerPath),
      compatibleRuntimes: [Runtime.NODEJS_16_X],
    });

    const videoAskTranscriptBucket = new Bucket(this, 'videoask-transcripts-storage', {
      bucketName: generateStackResourceName(props.config, 'videoask-transcripts-storage'),
      removalPolicy: props.isPreview ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: props.isPreview,
    });

    this.func = new lambda.Function(this, 'func', {
      functionName: generateStackResourceName(props.config, 'action-caller'),
      runtime: Runtime.NODEJS_16_X,
      handler: 'index.handler',
      layers: [modulesLayer],
      code: Code.fromAsset(codePath),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        ENV: props.config.environmentName,
        SSM_PARAMETER_CONFIG: props.ssmParameters.config.join(','),
        SSM_PARAMETER_SERVICE_ACCOUNT: props.ssmParameters.serviceAccount.join(','),
        VIDEOASK_BUCKET_NAME: videoAskTranscriptBucket.bucketName,
      },
      onFailure: props.failureSnsTopic
        ? new destinations.SnsDestination(
            sns.Topic.fromTopicArn(
              this,
              'failure-topic',
              util.build({
                accountId: AWSAccount,
                region: AWSRegion,
                service: 'sns',
                resource: props.failureSnsTopic,
              }),
            ),
          )
        : undefined,
    });

    this.func.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['*'],
        resources: [
          ...props.ssmParameters.config.map((name) =>
            util.build({
              service: 'ssm',
              region: AWSRegion,
              accountId: AWSAccount,
              resource: `parameter${name}`,
            }),
          ),
          ...props.ssmParameters.serviceAccount.map((name) =>
            util.build({
              service: 'ssm',
              region: AWSRegion,
              accountId: AWSAccount,
              resource: `parameter${name}`,
            }),
          ),
        ],
      }),
    );

    this.func.addToRolePolicy(ssmPolicy(props.config.environmentName));
    videoAskTranscriptBucket.grantReadWrite(this.func);

    // events
    if (!isPreview(props.config.environmentName)) {
      for (const ruleConfig of eventRules) {
        new events.Rule(this, `rule-${ruleConfig.name}`, {
          ruleName: generateStackResourceName(props.config, ruleConfig.name),
          schedule: Schedule.expression(ruleConfig.expression),
          targets: [new targets.LambdaFunction(this.func)],
          enabled: isProduction(props.config.environmentName) && !ruleConfig.disabled,
        });
      }
    }
  }

  func: lambda.Function;
}
