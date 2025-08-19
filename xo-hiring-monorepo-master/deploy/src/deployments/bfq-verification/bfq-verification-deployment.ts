import * as util from '@aws-sdk/util-arn-parser';
import { Deployment, InfraInitConfig, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration } from 'aws-cdk-lib';
import { Schedule } from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as ev_targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';
import { AWSAccount, AWSRegion, ProjectName } from '../../config/environments';
import {
  BfqVerificationBackendStackName,
  BfqVerificationConfiguration,
  BfqVerificationProjectName,
  LambdaProject,
} from './bfq-verification-configuration';

@Deployment(BfqVerificationProjectName, BfqVerificationBackendStackName)
export class BfqVerificationStack extends RootStack {
  constructor(config: StackConfig, private envConfig: BfqVerificationConfiguration) {
    super(patchStackConfig(config));

    const lambdaCode = lambda.Code.fromAsset(path.join(LambdaProject, 'dist/code'));
    const lambdaModules = new lambda.LayerVersion(this, this.config.generateLogicalId('lambda-layer'), {
      code: lambda.Code.fromAsset(path.join(LambdaProject, 'dist/layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      layerVersionName: this.generateName('lambda-layer'),
    });
    const lambdaRole = new iam.Role(this, this.config.generateLogicalId('lambda-execution'), {
      roleName: this.config.generateName('lambda-execution'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'));
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          util.build({
            service: 'secretsmanager',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `secret:${this.envConfig.jiraUserSecretName}-??????`,
          }),
        ],
      }),
    );

    const lambdaFunction = new lambda.Function(this, this.config.generateLogicalId(`bfq-verification-lambda`), {
      functionName: this.config.generateName('bfq-verification'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: `index.handler`,
      code: lambdaCode,
      layers: [lambdaModules],
      logRetention: this.envConfig.logRetention,
      environment: {
        ENV: this.config.environmentName,
        JIRA_DRY_RUN: `${this.envConfig.jiraDryRun}`,
        JIRA_USER_SECRET_NAME: this.envConfig.jiraUserSecretName,
      },
      timeout: Duration.minutes(15),
      role: lambdaRole,
      memorySize: 256,
    });

    new events.Rule(this, this.config.generateLogicalId('trigger'), {
      ruleName: this.generateName('trigger'),
      enabled: this.envConfig.eventBridgeEnabled,
      schedule: Schedule.expression(this.envConfig.eventBridgeScheduleExpression),
      targets: [new ev_targets.LambdaFunction(lambdaFunction)],
    });
  }
}

function patchStackConfig(config: StackConfig): StackConfig {
  const cfgInfra: InfraInitConfig = {
    ...config.infraConfig,
    projectName: `${ProjectName}-${BfqVerificationProjectName}`,
  };
  return new StackConfig(config.app, config.environmentName, cfgInfra, config.stackName, {
    ...config.props,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  });
}
