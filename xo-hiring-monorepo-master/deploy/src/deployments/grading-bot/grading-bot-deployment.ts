import * as util from '@aws-sdk/util-arn-parser';
import { Deployment, InfraInitConfig, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as path from 'path';
import { AWSAccount, AWSRegion, ProjectName } from '../../config/environments';
import { SqsSendMessageDynamicTarget } from '../interview-bot/sfn-task-sqs-send-message-dynamic';
import {
  DynamoDbTableNameOutput,
  GradingBotBackendStackName,
  GradingBotConfiguration,
  GradingBotLambdaProject,
  GradingBotProjectName,
  RestApiUrl,
} from './grading-bot-configuration';

@Deployment(GradingBotProjectName, GradingBotBackendStackName)
export class InterviewBotStack extends RootStack {
  private readonly ddbTable: ddb.Table;
  private readonly lambdaRole: iam.Role;
  private readonly lambdaCode: lambda.AssetCode;
  private readonly lambdaModules: lambda.LayerVersion;
  private readonly deadLetterQueue: sqs.Queue;
  private readonly tasksQueue: sqs.Queue;
  private readonly restApi: apigateway.RestApi;
  private readonly reportsBucket: s3.Bucket;
  private readonly delayQueueEvents: sfn.StateMachine;

  constructor(config: StackConfig, private envConfig: GradingBotConfiguration) {
    super(patchStackConfig(config));

    // API for communication
    this.restApi = this.createRestAPI();

    // Storage for grading tasks
    this.ddbTable = new ddb.Table(this, 'ddb-table-grading-bot-tasks', {
      tableName: this.config.generateName('tasks'),
      partitionKey: {
        name: 'pk',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: ddb.AttributeType.STRING,
      },
      deletionProtection: this.envConfig.deletionProtection,
      removalPolicy: this.envConfig.removalPolicy,
      stream: ddb.StreamViewType.NEW_AND_OLD_IMAGES,
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
    });

    // Bucket for batch reports
    this.reportsBucket = new s3.Bucket(this, 'grading-bot-batch-reports', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: this.config.generateName('batch-reports'),
      autoDeleteObjects: !this.envConfig.deletionProtection,
      removalPolicy: this.envConfig.removalPolicy,
    });

    // Generic lambda configuration for a single-project setup
    this.lambdaCode = lambda.Code.fromAsset(path.join(GradingBotLambdaProject, 'dist/code'));
    this.lambdaModules = new lambda.LayerVersion(this, 'grading-bot-layer', {
      code: lambda.Code.fromAsset(path.join(GradingBotLambdaProject, 'dist/layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
    });
    this.lambdaRole = new iam.Role(this, 'grading-bot-lambda-execution', {
      roleName: this.config.generateName('lambda-execution'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    this.lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'));
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSESFullAccess'));
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          util.build({
            accountId: AWSAccount,
            region: AWSRegion,
            service: 'secretsmanager',
            resource: `secret:${envConfig.openaiSecretName}-??????`,
          }),
        ],
        actions: ['secretsmanager:GetSecretValue'],
      }),
    );

    // Dead-letter queue for tasks
    this.deadLetterQueue = new sqs.Queue(this, 'grading-bot-dlq', {
      queueName: this.config.generateName('dlq'),
    });

    // Tasks queue
    this.tasksQueue = new sqs.Queue(this, 'grading-bot-tasks-queue', {
      queueName: this.config.generateName('tasks'),
      visibilityTimeout: Duration.minutes(20), // Max lambda timeout is 15 minutes
      deadLetterQueue: {
        maxReceiveCount: 2, // One native retry
        queue: this.deadLetterQueue,
      },
    });

    // Permissions
    this.tasksQueue.grantSendMessages(this.lambdaRole);
    this.tasksQueue.grantConsumeMessages(this.lambdaRole);
    this.ddbTable.grantFullAccess(this.lambdaRole);
    this.reportsBucket.grantReadWrite(this.lambdaRole);

    // Create State Machine to delay status events
    this.delayQueueEvents = this.createDelayedStatusEventSM();
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [this.delayQueueEvents.stateMachineArn],
        actions: ['states:StartExecution'],
      }),
    );

    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          util.build({
            service: 'secretsmanager',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `secret:${this.envConfig.googleCredentialsSecretName}-??????`,
          }),
        ],
        actions: ['secretsmanager:GetSecretValue'],
      }),
    );
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          `arn:aws:s3:::${this.envConfig.athenaResultBucket}*`,
          `arn:aws:s3:::${this.envConfig.athenaSourceBucket}*`,
        ],
        actions: ['s3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject'],
      }),
    );
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonAthenaFullAccess'));

    // Define lambdas
    const orderGradingHandler = this.createLambda('orderGradingHandler');
    const grading = this.restApi.root.addResource('grading');
    const order = grading.addResource('order');
    order.addMethod(
      'POST',
      new apigateway.LambdaIntegration(orderGradingHandler, {
        proxy: true,
      }),
    );

    const dryRunHandler = this.createLambda('dryRunGradingHandler');
    const dryRun = grading.addResource('dry-run');
    dryRun.addMethod(
      'POST',
      new apigateway.LambdaIntegration(dryRunHandler, {
        proxy: true,
      }),
    );

    const tasksQueueHandler = this.createLambda('tasksQueueHandler', {
      reservedConcurrentExecutions: 2,
    });
    tasksQueueHandler.addEventSource(
      new SqsEventSource(this.tasksQueue, {
        reportBatchItemFailures: true,
        batchSize: 10,
      }),
    );

    const ddbStreamHandler = this.createLambda('ddbStreamHandler');
    ddbStreamHandler.addEventSource(
      new DynamoEventSource(this.ddbTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 50,
        retryAttempts: 3,
      }),
    );

    this.addOutput(DynamoDbTableNameOutput, this.ddbTable.tableName);
    this.addOutput(RestApiUrl, `https://${this.envConfig.restApiDomainName(this.config.environmentName)}`);
  }

  createRestAPI(): apigateway.RestApi {
    const domainCertificate = Certificate.fromCertificateArn(
      this,
      'domain-certificate',
      this.envConfig.domainCertificateArn,
    );
    const domainName = this.envConfig.restApiDomainName(this.config.environmentName);
    const restApi = new apigateway.RestApi(this, this.config.generateLogicalId('rest'), {
      restApiName: this.config.generateName('rest'),
      description: 'Grading Bot REST API',
      deploy: true,
      deployOptions: {
        stageName: this.config.environmentName,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
      domainName: {
        domainName: domainName,
        certificate: domainCertificate,
      },
      endpointTypes: [apigateway.EndpointType.REGIONAL],
    });

    const domainConfig = restApi.domainName;
    if (domainConfig != null) {
      new route53.CnameRecord(this, 'rest-domain-record', {
        recordName: domainName,
        zone: route53.HostedZone.fromLookup(this, 'hosted-zone-rest', { domainName: this.envConfig.hostedZone }),
        domainName: domainConfig.domainNameAliasDomainName,
      });
    }

    return restApi;
  }

  createDelayedStatusEventSM() {
    const smRole = new iam.Role(this, 'delay-queue-events-sm-role', {
      roleName: this.generateName('delay-queue-events-sm-role'),
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
    });
    // Allow access to both queue types
    this.tasksQueue.grantSendMessages(smRole);

    const waitState = new sfn.Wait(this, 'Wait', {
      time: sfn.WaitTime.secondsPath('$.smInput.delayForSeconds'),
    });

    // Define the task to send a message to an SQS queue
    const sendMessageTask = new SqsSendMessageDynamicTarget(this, 'Send Message', {
      queueUrl: sfn.TaskInput.fromJsonPathAt('$.smInput.queueUrl'),
      messageBody: sfn.TaskInput.fromJsonPathAt('$.smInput.statusEvent'),
    });

    // Define the state machine
    const definition = waitState.next(sendMessageTask);

    return new sfn.StateMachine(this, 'delay-queue-events', {
      stateMachineName: this.generateName('delay-queue-events'),
      tracingEnabled: false,
      role: smRole,
      definition,
    });
  }

  createLambda(name: string, props?: Partial<lambda.FunctionProps>) {
    return new lambda.Function(this, this.config.generateLogicalId(`${name}-lambda`), {
      functionName: this.config.generateName(name),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: `${name}.handler`,
      code: this.lambdaCode,
      layers: [this.lambdaModules],
      logRetention: this.envConfig.logRetention,
      environment: {
        DDB_TABLE_MAIN: this.ddbTable.tableName,
        TASKS_QUEUE_URL: this.tasksQueue.queueUrl,
        ENV: this.config.environmentName,
        ATHENA_OUTPUT_LOCATION: this.envConfig.athenaResultBucket,
        ATHENA_DB: this.envConfig.athenaDb,
        GOOGLE_CREDENTIALS_SECRET_NAME: this.envConfig.googleCredentialsSecretName,
        BATCH_REPORTS_BUCKET: this.reportsBucket.bucketName,
        OPENAI_SECRET_NAME: this.envConfig.openaiSecretName,
        DELAY_QUEUE_EVENTS_SM_ARN: this.delayQueueEvents.stateMachineArn,
      },
      timeout: Duration.minutes(15),
      role: this.lambdaRole,
      memorySize: 512,
      ...props,
    });
  }
}

function patchStackConfig(config: StackConfig): StackConfig {
  const cfgInfra: InfraInitConfig = {
    ...config.infraConfig,
    projectName: `${ProjectName}-${GradingBotProjectName}`,
  };
  return new StackConfig(config.app, config.environmentName, cfgInfra, config.stackName, {
    ...config.props,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  });
}
