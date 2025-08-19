import * as util from '@aws-sdk/util-arn-parser';
import { Deployment, InfraInitConfig, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';
import { AWSAccount, AWSRegion, ProjectName } from '../../config/environments';
import { envSSMParametersName, kontentSecretName, openAiSecretName, secretAccess } from '../../utils/lambda-helpers';
import {
  DynamoDbTableNameOutput,
  InterviewAssistBackendStackName,
  InterviewAssistConfiguration,
  InterviewAssistLambdaProject,
  InterviewAssistProjectName,
  RestApiUrl,
} from './interview-assist-configuration';

@Deployment(InterviewAssistProjectName, InterviewAssistBackendStackName)
export class InterviewAssistStack extends RootStack {
  private readonly ddbTable: ddb.Table;
  private readonly lambdaRole: iam.Role;
  private readonly lambdaCode: lambda.AssetCode;
  private readonly lambdaModules: lambda.LayerVersion;
  private readonly restApi: apigateway.RestApi;
  private readonly tasksQueue: sqs.Queue;
  private readonly tasksDLQueue: sqs.Queue;

  constructor(config: StackConfig, private envConfig: InterviewAssistConfiguration) {
    super(patchStackConfig(config));

    // API for communication
    this.restApi = this.createRestAPI();

    // Storage for interview assist data
    this.ddbTable = new ddb.Table(this, 'ddb-table-interview-assist-data', {
      tableName: this.config.generateName('data'),
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
      pointInTimeRecovery: true,
    });

    // Generic lambda configuration for a single-project setup
    this.lambdaCode = lambda.Code.fromAsset(path.join(InterviewAssistLambdaProject, 'dist/code'));
    this.lambdaModules = new lambda.LayerVersion(this, 'interview-assist-layer', {
      code: lambda.Code.fromAsset(path.join(InterviewAssistLambdaProject, 'dist/layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    });
    this.lambdaRole = new iam.Role(this, 'interview-assist-lambda-execution', {
      roleName: this.config.generateName('lambda-execution'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    this.lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );
    // Allow to send emails
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSESFullAccess'));

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

    // Add OpenAI secret access
    this.lambdaRole.addToPolicy(secretAccess(openAiSecretName(this.envConfig.envType)));
    this.lambdaRole.addToPolicy(secretAccess(kontentSecretName(this.envConfig.envType)));

    // Add Bedrock permissions
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['bedrock:*'],
      }),
    );

    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [`arn:aws:dynamodb:${AWSRegion}:${AWSAccount}:table/${this.envConfig.interviewBotTableName}`],
        actions: ['dynamodb:BatchGetItem'],
      }),
    );

    this.ddbTable.grantFullAccess(this.lambdaRole);

    // Create SQS Queue
    this.tasksDLQueue = new sqs.Queue(this, this.config.generateLogicalId('tasks-dead-letter-queue'), {
      queueName: this.config.generateName('tasks-dead-letter'),
    });

    this.tasksQueue = new sqs.Queue(this, 'tasks-queue', {
      queueName: this.config.generateName('tasks'),
      visibilityTimeout: Duration.minutes(16),
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: this.tasksDLQueue,
      },
    });

    this.tasksQueue.grantSendMessages(this.lambdaRole);
    this.tasksQueue.grantConsumeMessages(this.lambdaRole);

    // Create tasks-processor lambda
    const tasksProcessorLambda = this.createLambda('tasks-processor', 'tasks-processor.processTasks');
    tasksProcessorLambda.addEventSource(
      new SqsEventSource(this.tasksQueue, {
        reportBatchItemFailures: true,
        batchSize: 10,
      }),
    );

    // Create webhook endpoint
    const receiveReadAiWebhook = this.restApi.root.addResource('readai-webhook');
    // Create secondary endpoint that allows passing of graderId as a path parameter
    const receiveReadAiWebhookWithGraderId = receiveReadAiWebhook.addResource('{graderId}');

    const readAiWebhookLambda = this.createLambda('readai-webhook', 'readai-webhook.handleReadAiWebhook');

    receiveReadAiWebhook.addMethod('POST', new apigateway.LambdaIntegration(readAiWebhookLambda, { proxy: true }));
    receiveReadAiWebhookWithGraderId.addMethod(
      'POST',
      new apigateway.LambdaIntegration(readAiWebhookLambda, { proxy: true }),
    );

    const userPool = cognito.UserPool.fromUserPoolId(this, 'userpool', this.envConfig.userPoolId);
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'authorizer', {
      cognitoUserPools: [userPool],
    });

    // Custom authorizer lambda which validates SF token
    const authorizerLambda = this.createLambda('authorizer', 'authorizer.handler');
    const sfAuthorizer = new apigateway.TokenAuthorizer(this, 'sf-authorizer', {
      authorizerName: this.config.generateName('sf-authorizer'),
      handler: authorizerLambda,
      identitySource: 'method.request.header.Authorization',
      resultsCacheTtl: Duration.minutes(5),
    });

    const cognitoAuth = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizationScopes: ['aws.cognito.signin.user.admin'],
    };

    const sfAuth = {
      authorizer: sfAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    };

    const interviewResource = this.restApi.root.addResource('interview').addResource('{asrId}');

    /**
     * @see Lambda Handler — [Source]({@link ../../../../packages/interview-assist/src/handlers/get-summary.ts})
     */
    const getSummaryLambda = this.createLambda('get-summary', 'get-summary.handler');
    const getSummaryEndpointResource = interviewResource.addResource('summary', {
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowHeaders: ['*'],
        allowMethods: ['GET', 'OPTIONS'],
      },
    });

    // Admin only endpoint using cognito auth (used in Profile360)
    getSummaryEndpointResource.addMethod('GET', new apigateway.LambdaIntegration(getSummaryLambda), cognitoAuth);

    const adminInterviewResource = this.restApi.root
      .addResource('admin')
      .addResource('interview')
      .addResource('{asrId}');

    const adminGetSummaryEndpointResource = adminInterviewResource.addResource('summary');
    const adminGradeInterviewChatResource = adminInterviewResource.addResource('chat');

    // Duplicate the endpoint for admin using SF auth
    adminGetSummaryEndpointResource.addMethod('GET', new apigateway.LambdaIntegration(getSummaryLambda), sfAuth);

    adminGradeInterviewChatResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(
        this.createLambda('get-grade-interview-chat', 'get-grade-interview-chat.handler'),
      ),
      sfAuth,
    );

    adminGradeInterviewChatResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(
        this.createLambda('post-grade-interview-chat', 'post-grade-interview-chat.handler'),
      ),
      sfAuth,
    );

    // Create email sender lambda
    const sendEmailLambda = this.createLambda('email-sender', 'email-sender.handler');
    sendEmailLambda.addEventSource(
      new DynamoEventSource(this.ddbTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 10,
        retryAttempts: 1,
      }),
    );

    // Create test summary generation endpoint
    const generateSummaryRestLambda = this.createLambda(
      'gen-summary',
      'generate-summary-rest.handleGenerateSummaryCall',
    );
    const generateSummaryResource = this.restApi.root.addResource('generate-summary');
    generateSummaryResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(generateSummaryRestLambda, {
        timeout: Duration.minutes(2),
      }),
      {
        requestParameters: {
          'method.request.querystring.transcriptionId': true,
          'method.request.querystring.promptId': false,
          'method.request.querystring.save': false,
        },
      },
    );

    // Create daily grader reminder Lambda
    const graderReminderLambda = this.createLambda('grader-reminder', 'grader-reminder.handler');
    this.ddbTable.grantReadData(graderReminderLambda);

    // Schedule a daily run of the reminder Lambda
    const dailyReminderRule = new events.Rule(this, this.config.generateLogicalId('grader-reminder-rule'), {
      ruleName: this.config.generateName('grader-reminder-rule'),
      enabled: this.envConfig.dailyReminderEnabled,
      schedule: events.Schedule.cron({ minute: '0', hour: '10' }),
    });
    dailyReminderRule.addTarget(new targets.LambdaFunction(graderReminderLambda));

    // Add outputs for CloudFormation
    this.addOutputs();
  }

  // Create REST API with custom domain
  private createRestAPI(): apigateway.RestApi {
    const domainName = this.envConfig.restApiDomainName(this.config.environmentName);
    const domainCertificate = Certificate.fromCertificateArn(
      this,
      'ia-domain-certificate',
      this.envConfig.domainCertificateArn,
    );

    const restApi = new apigateway.RestApi(this, this.config.generateLogicalId('rest'), {
      restApiName: this.config.generateName('rest'),
      description: 'Interview Assist REST API',
      deploy: true,
      deployOptions: {
        stageName: this.config.environmentName,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
      domainName: {
        domainName: domainName,
        certificate: domainCertificate,
      },
    });

    const domainConfig = restApi.domainName;
    if (domainConfig != null) {
      new route53.CnameRecord(this, 'ia-rest-domain-record', {
        recordName: domainName,
        zone: route53.HostedZone.fromLookup(this, 'ia-hosted-zone-rest', { domainName: this.envConfig.hostedZone }),
        domainName: domainConfig.domainNameAliasDomainName,
      });
    }

    return restApi;
  }

  private createLambda(name: string, handlerName?: string): lambda.Function {
    return new lambda.Function(this, this.config.generateLogicalId(`lambda-${name}`), {
      functionName: this.config.generateName(`lambda-${name}`).slice(0, 64),
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: handlerName ?? `${name}.handler`,
      code: this.lambdaCode,
      layers: [this.lambdaModules],
      role: this.lambdaRole,
      timeout: Duration.minutes(15),
      memorySize: 512,
      environment: {
        ENV: this.config.environmentName,
        DDB_DATA_TABLE_NAME: this.ddbTable.tableName,
        TASKS_QUEUE_URL: this.tasksQueue.queueUrl,
        OPENAI_SECRET_NAME: openAiSecretName(this.envConfig.envType),
        KONTENT_SECRET_NAME: kontentSecretName(this.envConfig.envType),
        IB_TABLE_NAME: this.envConfig.interviewBotTableName,
        INTERVIEW_BOT_API_URL: this.envConfig.interviewBotApiUrl(this.config.environmentName),
      },
    });
  }

  private addOutputs(): void {
    this.addOutput(DynamoDbTableNameOutput, this.ddbTable.tableName);
    this.addOutput(RestApiUrl, `https://${this.envConfig.restApiDomainName(this.config.environmentName)}`);
  }
}

function patchStackConfig(config: StackConfig): StackConfig {
  const cfgInfra: InfraInitConfig = {
    ...config.infraConfig,
    projectName: `${ProjectName}-${InterviewAssistProjectName}`,
  };
  return new StackConfig(config.app, config.environmentName, cfgInfra, config.stackName, {
    ...config.props,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  });
}
