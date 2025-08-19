import * as util from '@aws-sdk/util-arn-parser';
import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaDestinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as path from 'path';
import { AWSAccount, AWSRegion } from '../../config/environments';
import {
  EnvironmentType,
  envSSMParametersName,
  kontentSecretName,
  openAiSecretName,
  secretAccess,
} from '../../utils/lambda-helpers';
import {
  AutomationsBackendStackName,
  AutomationsConfiguration,
  AutomationsLambdaProject,
  AutomationsProjectName,
} from './automations-configuration';

@Deployment(AutomationsProjectName, AutomationsBackendStackName)
export class AutomationsStack extends RootStack {
  private readonly lambdaRole: iam.Role;
  private readonly lambdaCode: lambda.AssetCode;
  private readonly lambdaModules: lambda.LayerVersion;
  private readonly failureTopic: sns.ITopic;

  constructor(config: StackConfig, private envConfig: AutomationsConfiguration) {
    super(config);

    // Create the failure SNS topic reference
    this.failureTopic = sns.Topic.fromTopicArn(
      this,
      'automations-failure-topic',
      `arn:aws:sns:${AWSRegion}:${AWSAccount}:${this.envConfig.failureSnsTopic}`,
    );

    // Generic lambda configuration for a single-project setup
    this.lambdaCode = lambda.Code.fromAsset(path.join(AutomationsLambdaProject, 'dist/code'));
    this.lambdaModules = new lambda.LayerVersion(this, 'automations-lambda-layer', {
      code: lambda.Code.fromAsset(path.join(AutomationsLambdaProject, 'dist/layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    });

    this.lambdaRole = new iam.Role(this, 'automations-lambda-execution', {
      roleName: this.config.generateName('automations-lambda-execution'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // Add basic lambda execution permissions
    this.lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );

    // Add SES permissions for sending emails
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSESFullAccess'));

    // Add SSM read permissions
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'));

    this.lambdaRole.addToPolicy(secretAccess(openAiSecretName(this.envConfig.envType)));
    this.lambdaRole.addToPolicy(secretAccess(kontentSecretName(this.envConfig.envType)));

    // Allow publishing to SNS failure topic
    this.failureTopic.grantPublish(this.lambdaRole);

    // Allow to write and read salesforce parameters from SSM
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          util.build({
            service: 'ssm',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: envSSMParametersName(this.envConfig.envType),
          }),
        ],
        actions: ['*'],
      }),
    );

    // Create the grading-escalation lambda function
    const gradingEscalationLambda = this.createLambda('grading-escalation', {
      handler: 'grading-escalation.checkGradingTasks',
      description: 'Lambda function that handles grading escalation automation',
    });

    // Schedule the lambda to run on weekdays at 8 AM EST (13:00 UTC)
    new events.Rule(this, 'ScheduleGradingEscalation', {
      ruleName: this.config.generateName('grading-escalation-schedule'),
      schedule: events.Schedule.cron({ hour: '13', minute: '0', weekDay: 'MON-FRI' }), // 8 AM EST = 13:00 UTC, weekdays only
      targets: [new targets.LambdaFunction(gradingEscalationLambda)],
      enabled: this.envConfig.envType === EnvironmentType.Production,
    });
  }

  private createLambda(name: string, props?: Partial<lambda.FunctionProps>): lambda.Function {
    return new lambda.Function(this, `${name}-lambda`, {
      functionName: this.config.generateName(name),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: `${name}.handler`,
      code: this.lambdaCode,
      layers: [this.lambdaModules],
      logRetention: this.envConfig.logRetention,
      environment: {
        ENV: this.config.environmentName,
        ESCALATION_CONFIG_PARAM: this.envConfig.escalationConfigParam,
      },
      timeout: Duration.minutes(15),
      role: this.lambdaRole,
      memorySize: 512,
      onFailure: new lambdaDestinations.SnsDestination(this.failureTopic),
      ...props,
    });
  }
}
