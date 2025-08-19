import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration } from 'aws-cdk-lib';
import { EventBus } from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as util from '@aws-sdk/util-arn-parser';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import { AWSAccount, AWSRegion } from '../../config/environments';
import {
  EnvironmentType,
  envSSMParametersName,
  indeedSecretName,
  kontentSecretName,
  openAiSecretName,
  secretAccess,
} from '../../utils/lambda-helpers';
import {
  SourcingManagerBackendStackName,
  SourcingManagerConfiguration,
  SourcingManagerLambdaProject,
  SourcingManagerProjectName,
} from './sourcing-manager-configuration';

@Deployment(SourcingManagerProjectName, SourcingManagerBackendStackName)
export class SourcingManagerStack extends RootStack {
  private readonly lambdaRole: iam.Role;
  private readonly lambdaCode: lambda.AssetCode;
  private readonly lambdaModules: lambda.LayerVersion;
  private readonly sourcingOutputBucket: s3.Bucket;
  private readonly sourcingAccessLogsBucket: s3.Bucket;
  private readonly internalDataBucket: s3.Bucket;
  private readonly failureTopic: sns.ITopic;
  private readonly applicationEventQueue: sqs.Queue;
  private readonly applicationEventDLQ: sqs.Queue;
  private readonly applicationEventHandler: lambda.Function;

  constructor(config: StackConfig, private envConfig: SourcingManagerConfiguration) {
    super(config);

    // Create the failure SNS topic reference once
    this.failureTopic = sns.Topic.fromTopicArn(
      this,
      'failure-topic',
      `arn:aws:sns:${AWSRegion}:${AWSAccount}:${this.envConfig.failureSnsTopic}`,
    );

    // Bucket for the access logs - to keep track when the external consumers access the data
    this.sourcingAccessLogsBucket = new s3.Bucket(this, 'sourcing-access-logs-bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketName: this.config.generateName('sourcing-access-logs'),
      autoDeleteObjects: this.envConfig.envType !== EnvironmentType.Production,
      removalPolicy: this.envConfig.removalPolicy,
    });

    // Sourcing bucket for the artifacts consumed by the external systems
    this.sourcingOutputBucket = new s3.Bucket(this, 'sourcing-output-bucket', {
      publicReadAccess: true, // Public, since external systems will consume the data
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
        ignorePublicAcls: false,
      },
      bucketName: this.config.generateName('sourcing-output'),
      versioned: true,
      autoDeleteObjects: this.envConfig.envType !== EnvironmentType.Production,
      removalPolicy: this.envConfig.removalPolicy,
      serverAccessLogsBucket: this.sourcingAccessLogsBucket,
      serverAccessLogsPrefix: 'sourcing-output/',
    });

    // Internal data bucket for job ad variations
    this.internalDataBucket = new s3.Bucket(this, 'sourcing-internal-data-bucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketName: this.config.generateName('sourcing-internal-data'),
      versioned: true,
      autoDeleteObjects: this.envConfig.envType !== EnvironmentType.Production,
      removalPolicy: this.envConfig.removalPolicy,
    });

    // Generic lambda configuration for a single-project setup
    this.lambdaCode = lambda.Code.fromAsset(path.join(SourcingManagerLambdaProject, 'dist/code'));
    this.lambdaModules = new lambda.LayerVersion(this, 'sourcing-manager-lambda-layer', {
      code: lambda.Code.fromAsset(path.join(SourcingManagerLambdaProject, 'dist/layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    });
    this.lambdaRole = new iam.Role(this, 'sourcing-manager-lambda-execution', {
      roleName: this.config.generateName('lambda-execution'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    this.lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'));
    this.lambdaRole.addToPolicy(secretAccess(openAiSecretName(this.envConfig.envType)));
    this.lambdaRole.addToPolicy(secretAccess(indeedSecretName(this.envConfig.envType)));
    this.lambdaRole.addToPolicy(secretAccess(kontentSecretName(this.envConfig.envType)));

    // Allow to write and read the salesforce authorizer from SSM
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

    // Allow bedrock access
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['bedrock:InvokeModel'],
      }),
    );

    // Permissions
    this.sourcingOutputBucket.grantReadWrite(this.lambdaRole);
    this.internalDataBucket.grantReadWrite(this.lambdaRole);

    // Define lambdas
    const generateJobAdsTitleVariations = this.createLambda('sm-generate-job-ads-title-variations', {
      handler: 'generate-job-ads-title-variations.generateJobAdsTitleVariations',
    });
    generateJobAdsTitleVariations
      .addEnvironment('JOB_AD_VARIATION_OUTPUT_BUCKET', this.internalDataBucket.bucketName)
      .addEnvironment('KONTENT_SECRET_NAME', kontentSecretName(this.envConfig.envType));

    const xFeedGenerator = this.createLambda('sm-x-feed-generator', {
      handler: 'x-feed-generator.handler',
    });

    const indeedFeedGenerator = this.createLambda('sm-indeed-feed-generator', {
      handler: 'indeed-feed-generator.handler',
    });
    indeedFeedGenerator
      .addEnvironment('INDEED_SECRETS_NAME', indeedSecretName(this.envConfig.envType))
      .addEnvironment('LEGACY_OUTPUT_BUCKET_NAME', this.envConfig.indeed.legacyBucketName);

    const recruiticsFeedGenerator = this.createLambda('sm-recruitics-feed-generator', {
      handler: 'recruitics-feed-generator.handler',
    });

    const linkedInFeedGenerator = this.createLambda('sm-li-feed-generator', {
      handler: 'linkedin-feed-generator.generateLinkedInXMLFeed',
    });

    const jobadxFeedGenerator = this.createLambda('sm-jobadx-feed-generator', {
      handler: 'jobadx-feed-generator.handler',
    });

    // Schedule the lambda to run daily at 18:00 UTC
    new events.Rule(this, 'ScheduleJobAdxFeedGenerator', {
      schedule: events.Schedule.cron({ hour: '18', minute: '0' }),
      targets: [new targets.LambdaFunction(jobadxFeedGenerator)],
      enabled: this.envConfig.envType === EnvironmentType.Production,
    });

    // Indeed Analytics Fetcher
    const athenaAnalyticsBucket = s3.Bucket.fromBucketName(
      this,
      'analytics-bucket',
      this.envConfig.indeed.athenaAnalyticsBucket,
    );
    athenaAnalyticsBucket.grantReadWrite(this.lambdaRole);

    const indeedFetchAnalytics = this.createLambda('sm-indeed-fetch-analytics', {
      handler: 'indeed-fetch-analytics.handler',
    });
    indeedFetchAnalytics
      .addEnvironment('INDEED_SECRETS_NAME', indeedSecretName(this.envConfig.envType))
      .addEnvironment('ATHENA_ANALYTICS_BUCKET', this.envConfig.indeed.athenaAnalyticsBucket);

    // Schedule the lambda to run daily at 18:00 UTC
    new events.Rule(this, 'ScheduleIndeedFetchAnalytics', {
      schedule: events.Schedule.cron({ minute: '0', hour: '18' }),
      targets: [new targets.LambdaFunction(indeedFetchAnalytics)],
      enabled: this.envConfig.envType === EnvironmentType.Production,
    });

    // Allow to write into the Indeed legacy bucket
    const legacyBucket = s3.Bucket.fromBucketName(this, 'legacyIndeedBucket', this.envConfig.indeed.legacyBucketName);
    legacyBucket.grantWrite(this.lambdaRole);

    // Create Dead Letter Queue for failed application events
    this.applicationEventDLQ = new sqs.Queue(this, 'application-event-dlq', {
      queueName: `${this.config.generateName('application-event-dlq')}.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      retentionPeriod: Duration.days(14),
      removalPolicy: this.envConfig.removalPolicy,
    });

    // Create SQS FIFO queue for application events
    this.applicationEventQueue = new sqs.Queue(this, 'application-event-queue', {
      queueName: `${this.config.generateName('application-event-queue')}.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: Duration.minutes(4),
      retentionPeriod: Duration.days(14),
      removalPolicy: this.envConfig.removalPolicy,
      deadLetterQueue: {
        queue: this.applicationEventDLQ,
        maxReceiveCount: 1, // Send to DLQ after 1 failed attempt (no retries)
      },
    });

    // Create application event handler lambda
    this.applicationEventHandler = this.createLambda('sm-application-event-handler', {
      handler: 'application-event-handler.handleApplicationEvents',
      reservedConcurrentExecutions: 1,
      timeout: Duration.minutes(2),
      retryAttempts: 0,
    });
    this.applicationEventHandler.addEnvironment('INDEED_SECRETS_NAME', indeedSecretName(this.envConfig.envType));

    // Add SQS queue as event source for the lambda
    this.applicationEventHandler.addEventSource(
      new lambdaEventSources.SqsEventSource(this.applicationEventQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    // Create EventBridge rule if partner event source ARN is configured
    if (this.envConfig.sfPartnerEventSourceArn) {
      const eventBus = EventBus.fromEventBusArn(this, 'sf-event-bus', this.envConfig.sfPartnerEventSourceArn);
      new events.Rule(this, 'sf-event-relay-application-stage-rule', {
        ruleName: this.generateName(`sf-application-stage-events`),
        eventPattern: {
          account: [AWSAccount],
        },
        targets: [
          new targets.SqsQueue(this.applicationEventQueue, {
            messageGroupId: 'application-stage-events',
          }),
        ],
        enabled: this.envConfig.envType === EnvironmentType.Production, // Disabled for non-prod envs
        eventBus,
      });
    }

    this.addOutput(
      'XFeedGeneratorLambda',
      `https://${AWSRegion}.console.aws.amazon.com/lambda/home?region=${AWSRegion}#/functions/${xFeedGenerator.functionName}?tab=code`,
    );
    this.addOutput(
      'IndeedFeedGeneratorLambda',
      `https://${AWSRegion}.console.aws.amazon.com/lambda/home?region=${AWSRegion}#/functions/${indeedFeedGenerator.functionName}?tab=code`,
    );
    this.addOutput(
      'LinkedInFeedGeneratorLambda',
      `https://${AWSRegion}.console.aws.amazon.com/lambda/home?region=${AWSRegion}#/functions/${linkedInFeedGenerator.functionName}?tab=code`,
    );
    this.addOutput(
      'RecruiticsFeedGeneratorLambda',
      `https://${AWSRegion}.console.aws.amazon.com/lambda/home?region=${AWSRegion}#/functions/${recruiticsFeedGenerator.functionName}?tab=code`,
    );
    this.addOutput(
      'JobAdxFeedGeneratorLambda',
      `https://${AWSRegion}.console.aws.amazon.com/lambda/home?region=${AWSRegion}#/functions/${jobadxFeedGenerator.functionName}?tab=code`,
    );
    this.addOutput(
      'SourcingOutputBucket',
      `https://${AWSRegion}.console.aws.amazon.com/s3/buckets/${this.sourcingOutputBucket.bucketName}`,
    );
    this.addOutput(
      'SourcingAccessLogsBucket',
      `https://${AWSRegion}.console.aws.amazon.com/s3/buckets/${this.sourcingAccessLogsBucket.bucketName}`,
    );
    this.addOutput(
      'IndeedFetchAnalyticsLambda',
      `https://${AWSRegion}.console.aws.amazon.com/lambda/home?region=${AWSRegion}#/functions/${indeedFetchAnalytics.functionName}?tab=code`,
    );
    this.addOutput(
      'InternalDataBucket',
      `https://${AWSRegion}.console.aws.amazon.com/s3/buckets/${this.internalDataBucket.bucketName}`,
    );
  }

  createLambda(name: string, props?: Partial<lambda.FunctionProps>) {
    const lambdaFunction = new lambda.Function(this, `${name}-lambda`, {
      functionName: this.config.generateName(name),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: `${name}.handler`,
      code: this.lambdaCode,
      layers: [this.lambdaModules],
      logRetention: this.envConfig.logRetention,
      environment: {
        ENV: this.config.environmentName,
        OUTPUT_BUCKET: this.sourcingOutputBucket.bucketName,
        OPENAI_SECRET_NAME: openAiSecretName(this.envConfig.envType),
      },
      timeout: Duration.minutes(15),
      role: this.lambdaRole,
      memorySize: 512,
      ...props,
    });

    // Create CloudWatch Alarm for Lambda errors
    // Since the lambda runs once per day, we set the evaluation period to 1 day
    // and alarm if there are any errors during that period
    const errorAlarm = new cloudwatch.Alarm(this, `${name}-error-alarm`, {
      alarmName: this.config.generateName(`${name}-errors`),
      metric: lambdaFunction.metricErrors({
        period: Duration.days(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      alarmDescription: `Alarm when ${name} Lambda function encounters errors during its daily execution`,
      actionsEnabled: true,
    });

    // Add the existing failure SNS topic as an action to the alarm
    errorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.failureTopic));

    return lambdaFunction;
  }
}
