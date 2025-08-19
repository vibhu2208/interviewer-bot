import * as util from '@aws-sdk/util-arn-parser';
import { Deployment, InfraInitConfig, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration, Expiration } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { MethodLoggingLevel } from 'aws-cdk-lib/aws-apigateway';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { AuthorizationType, BaseDataSource, FieldLogLevel } from 'aws-cdk-lib/aws-appsync';
import { Certificate, ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';
import { StreamViewType } from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as path from 'path';
import { AWSAccount, AWSRegion, ProjectName } from '../../config/environments';
import { athenaBucketAccess } from '../../utils/lambda-helpers';
import {
  DynamoDbTableNameOutput,
  GraphQLApiUrl,
  GraphQLResolversProject,
  GraphQLSchemaFile,
  InterviewBotBackendStackName,
  InterviewBotConfiguration,
  InterviewBotProjectName,
  LambdaProject,
  RestApiUrl,
} from './interview-bot-configuration';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { SqsSendMessageDynamicTarget } from './sfn-task-sqs-send-message-dynamic';
import { InterviewBotDashboard } from './interview-bot-dashboard';

@Deployment(InterviewBotProjectName, InterviewBotBackendStackName)
export class InterviewBotStack extends RootStack {
  private readonly snsTopicArn: string;
  private readonly appSyncApi: appsync.GraphqlApi;
  private readonly ddbTable: ddb.Table;
  private readonly ddbMainDataSource: appsync.DynamoDbDataSource;
  private readonly noneDataSource: appsync.NoneDataSource;
  private readonly restApi: apigateway.RestApi;
  private readonly gptCommandQueue: sqs.Queue;
  private readonly statusEventsQueue: sqs.Queue;
  private readonly deadLetterQueueGpt: sqs.Queue;
  private readonly deadLetterQueueStatus: sqs.Queue;
  private readonly lambdaRole: iam.Role;
  private readonly lambdaCode: lambda.AssetCode;
  private readonly lambdaModules: lambda.LayerVersion;
  private readonly domainCertificate: ICertificate;
  private readonly delayStatusEventSM: sfn.StateMachine;

  constructor(config: StackConfig, private envConfig: InterviewBotConfiguration) {
    super(patchStackConfig(config));

    this.domainCertificate = Certificate.fromCertificateArn(
      this,
      'domain-certificate',
      this.envConfig.domainCertificateArn,
    );

    if (this.envConfig.failureSnsTopic) {
      this.snsTopicArn = util.build({
        accountId: AWSAccount,
        region: AWSRegion,
        service: 'sns',
        resource: this.envConfig.failureSnsTopic,
      });
    } else {
      const snsTopic = new Topic(this, this.config.generateLogicalId('failures'), {
        topicName: this.config.generateName('failures'),
      });
      this.snsTopicArn = snsTopic.topicArn;
    }

    this.ddbTable = this.createDynamoDbTable();
    this.appSyncApi = this.createAppSyncAPI();

    this.ddbMainDataSource = this.appSyncApi.addDynamoDbDataSource('ddb-main', this.ddbTable, {
      name: this.generateName('ddb-main'),
      description: 'DynamoDB Main Table',
    });

    this.noneDataSource = this.appSyncApi.addNoneDataSource('none', {
      name: this.generateName('none'),
      description: 'Default NONE DataSource',
    });

    this.lambdaCode = lambda.Code.fromAsset(path.join(LambdaProject, 'dist/code'));
    this.lambdaModules = new lambda.LayerVersion(this, this.config.generateLogicalId('lambda-layer'), {
      code: lambda.Code.fromAsset(path.join(LambdaProject, 'dist/layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      layerVersionName: this.generateName('lambda-layer'),
    });
    this.lambdaRole = new iam.Role(this, this.config.generateLogicalId('lambda-execution'), {
      roleName: this.config.generateName('lambda-execution'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    this.lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMReadOnlyAccess'));
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
    // Allow AppSync invocation to trigger subscriptions (authorized via @aws_iam)
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          util.build({
            accountId: AWSAccount,
            region: AWSRegion,
            service: 'appsync',
            resource: `apis/${this.appSyncApi.apiId}/*`,
          }),
        ],
        actions: ['appsync:GraphQL'],
      }),
    );
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [this.snsTopicArn],
        actions: ['sns:Publish'],
      }),
    );
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['bedrock:InvokeModel'],
      }),
    );
    this.lambdaRole.addToPolicy(athenaBucketAccess(this.envConfig.envType));
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonAthenaFullAccess'));

    this.restApi = this.createRestAPI();

    this.deadLetterQueueGpt = new sqs.Queue(this, this.config.generateLogicalId('dead-letter-gpt'), {
      queueName: this.config.generateName('dead-letter-gpt'),
    });

    this.deadLetterQueueStatus = new sqs.Queue(this, this.config.generateLogicalId('dead-letter-status'), {
      queueName: this.config.generateName('dead-letter-status'),
    });

    this.gptCommandQueue = new sqs.Queue(this, this.config.generateLogicalId('gpt-commands'), {
      queueName: this.config.generateName('gpt-commands'),
      visibilityTimeout: Duration.minutes(7), // Max lambda timeout is 5 minutes
      deadLetterQueue: {
        maxReceiveCount: 1, // We retry manually from the handler
        queue: this.deadLetterQueueGpt,
      },
    });

    this.statusEventsQueue = new sqs.Queue(this, this.config.generateLogicalId('status-events'), {
      queueName: this.config.generateName('status-events'),
      visibilityTimeout: Duration.minutes(30), // Max retry delay is 15 minutes
      deadLetterQueue: {
        maxReceiveCount: 1, // We retry manually from the handler
        queue: this.deadLetterQueueStatus,
      },
    });

    this.statusEventsQueue.grantSendMessages(this.lambdaRole);
    this.statusEventsQueue.grantConsumeMessages(this.lambdaRole);
    this.ddbTable.grantFullAccess(this.lambdaRole);
    this.gptCommandQueue.grantSendMessages(this.lambdaRole);
    this.gptCommandQueue.grantConsumeMessages(this.lambdaRole);

    // Create State Machine to delay status events
    this.delayStatusEventSM = this.createDelayedStatusEventSM();
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [this.delayStatusEventSM.stateMachineArn],
        actions: ['states:StartExecution'],
      }),
    );

    const assessmentOrderLambda = this.createLambda('orderAssessment');
    const assessment = this.restApi.root.addResource('assessment');
    const order = assessment.addResource('order');
    order.addMethod(
      'POST',
      new apigateway.LambdaIntegration(assessmentOrderLambda, {
        proxy: true,
      }),
    );

    const fetchInterviewConversations = this.createLambda('fetchInterviewConversations');
    const matchingInterviewConversationsResource = this.restApi.root.addResource('interview-conversations');
    matchingInterviewConversationsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(fetchInterviewConversations, {
        proxy: true,
      }),
    );

    const generateCalibratedQuestionsLambda = this.createLambda('generateCalibratedQuestions');
    const questions = this.restApi.root.addResource('questions');
    const generate = questions.addResource('generate');
    generate.addMethod(
      'POST',
      new apigateway.LambdaIntegration(generateCalibratedQuestionsLambda, {
        proxy: true,
      }),
    );

    const gptCommandProcessLambda = this.createLambda('processGptCommandQueue');
    gptCommandProcessLambda.addEventSource(
      new SqsEventSource(this.gptCommandQueue, {
        reportBatchItemFailures: true,
      }),
    );

    const processDdbStreamLambda = this.createLambda('processDdbStream');
    processDdbStreamLambda.addEventSource(
      new DynamoEventSource(this.ddbTable, {
        startingPosition: StartingPosition.TRIM_HORIZON,
        batchSize: 50,
      }),
    );

    const statusEventsProcessLambda = this.createLambda('processStatusEventsQueue');
    statusEventsProcessLambda.addEventSource(
      new SqsEventSource(this.statusEventsQueue, {
        reportBatchItemFailures: false,
      }),
    );

    this.attachAppSyncResolvers();

    // Create CloudWatch dashboard for A/B testing monitoring
    const monitoringDashboard = new InterviewBotDashboard(this, 'monitoring-dashboard', {
      config: this.config,
      envConfig: this.envConfig,
      pilotSkillId: '21600000-0000-0000-0000-000000000000', // AI-First Lead Product Owner
    });

    this.addOutput(DynamoDbTableNameOutput, this.ddbTable.tableName);
    this.addOutput(RestApiUrl, `https://${this.envConfig.restApiDomainName(this.config.environmentName)}`);
    this.addOutput(GraphQLApiUrl, `https://${this.envConfig.gqlApiDomainName(this.config.environmentName)}/graphql`);
  }

  createDelayedStatusEventSM() {
    const smRole = new iam.Role(this, 'delay-status-event-sm-role', {
      roleName: this.generateName('delay-status-event-sm-role'),
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
    });
    // Allow access to both queue types
    this.statusEventsQueue.grantSendMessages(smRole);
    this.gptCommandQueue.grantSendMessages(smRole);

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

    return new sfn.StateMachine(this, 'delay-status-events', {
      stateMachineName: this.generateName('delay-status-events'),
      tracingEnabled: false,
      role: smRole,
      definition,
    });
  }

  createLambda(name: string) {
    return new lambda.Function(this, this.config.generateLogicalId(`${name}-lambda`), {
      functionName: this.config.generateName(name),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: `${name}.handler`,
      code: this.lambdaCode,
      layers: [this.lambdaModules],
      logRetention: this.envConfig.logRetention,
      environment: {
        DDB_TABLE_MAIN: this.ddbTable.tableName,
        GPT_QUEUE_URL: this.gptCommandQueue.queueUrl,
        STATUS_EVENT_QUEUE_URL: this.statusEventsQueue.queueUrl,
        FRONTEND_URL: this.envConfig.frontendUrl,
        ENV: this.config.environmentName,
        OPENAI_SECRET_NAME: this.envConfig.openaiSecretName,
        APPSYNC_ENDPOINT_URL: this.appSyncApi.graphqlUrl,
        SNS_TOPIC_ARN: this.snsTopicArn,
        DELAYED_STATUS_EVENT_SM_ARN: this.delayStatusEventSM.stateMachineArn,
        ATHENA_DATABASE_NAME: this.envConfig.athenaDatabaseName,
      },
      timeout: Duration.minutes(5),
      role: this.lambdaRole,
      memorySize: 512,
    });
  }

  createRestAPI(): apigateway.RestApi {
    const domainName = this.envConfig.restApiDomainName(this.config.environmentName);
    const restApi = new apigateway.RestApi(this, this.config.generateLogicalId('rest'), {
      restApiName: this.config.generateName('rest'),
      description: 'Interview Bot REST API',
      deploy: true,
      deployOptions: {
        stageName: this.config.environmentName,
        loggingLevel: MethodLoggingLevel.INFO,
      },
      domainName: {
        domainName: domainName,
        certificate: this.domainCertificate,
      },
    });

    const domainConfig = restApi.domainName;
    if (domainConfig != null) {
      new route53.CnameRecord(this, 'rest-domain-record', {
        recordName: domainName,
        zone: HostedZone.fromLookup(this, 'hosted-zone-rest', { domainName: this.envConfig.hostedZone }),
        domainName: domainConfig.domainNameAliasDomainName,
      });
    }

    return restApi;
  }

  attachAppSyncResolvers(): void {
    this.createAppSyncJSResolver('Query', 'getSessionById');
    this.createAppSyncJSResolver('Mutation', 'setQuestionAnswer');
    this.createAppSyncJSResolver('Mutation', 'markSessionAsCompleted');
    this.createAppSyncJSResolver('Mutation', 'recordFeedback');
    this.createAppSyncJSResolver('Mutation', 'recordSessionEvent');
    this.createAppSyncJSResolver('Mutation', 'triggerAnswerAttempted'); // Echo resolver for subscription
    this.createAppSyncJSResolver('Session', 'skill');

    const attemptAnswerLambda = this.createLambda('gqlAttemptAnswer');
    const attemptAnswerDataSource = this.appSyncApi.addLambdaDataSource('gqlAttemptAnswer', attemptAnswerLambda);
    this.createAppSyncJSResolver('Mutation', 'attemptAnswer', {
      dataSource: attemptAnswerDataSource,
    });

    const updateSessionStartTime = this.createAppSyncFunction(
      'fn_updateSessionStart',
      this.ddbMainDataSource,
      'updateSessionStart.js',
    );
    this.createAppSyncJSResolver('Session', 'questions', { additionalPipelineFns: [updateSessionStartTime] });
  }

  /**
   * Add new JS resolver to the AppSync API. It will also create an AppSync Function
   * @param type type name (i.e. "Query")
   * @param field field name (i.e. "getSessionById")
   * @param options additional options
   */
  createAppSyncJSResolver(type: string, field: string, options?: CreateResolverOptions): appsync.Resolver {
    const fileName = options?.fileName ?? `${type}.${field}.js`;
    const dataSource = options?.dataSource ?? this.ddbMainDataSource;

    const fn = this.createAppSyncFunction(`fn_${type}_${field}`, dataSource, fileName);

    return new appsync.Resolver(this, `${type}-${field}`, {
      api: this.appSyncApi,
      typeName: type,
      fieldName: field,
      code: passthrough,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      pipelineConfig: [fn, ...(options?.additionalPipelineFns ?? [])],
    });
  }

  createAppSyncFunction(name: string, dataSource?: BaseDataSource, fileName?: string): appsync.AppsyncFunction {
    return new appsync.AppsyncFunction(this, name, {
      api: this.appSyncApi,
      name: name,
      code: appsync.Code.fromAsset(path.resolve(GraphQLResolversProject, `dist/${fileName}`)),
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      dataSource: dataSource ?? this.ddbMainDataSource,
    });
  }

  createDynamoDbTable(): ddb.Table {
    const table = new ddb.Table(this, this.config.generateLogicalId('main'), {
      tableName: this.config.generateName('main'),
      partitionKey: {
        name: 'pk',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: ddb.AttributeType.STRING,
      },
      deletionProtection: this.envConfig.ddbDeletionProtection,
      removalPolicy: this.envConfig.removalPolicy,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: {
        name: 'gsi1pk',
        type: ddb.AttributeType.STRING,
      },
      sortKey: {
        name: 'gsi1sk',
        type: ddb.AttributeType.STRING,
      },
      projectionType: ddb.ProjectionType.ALL,
    });

    return table;
  }

  createAppSyncAPI(): appsync.GraphqlApi {
    const appsyncDomainName = new appsync.CfnDomainName(this, 'appsync-domain-name', {
      domainName: this.envConfig.gqlApiDomainName(this.config.environmentName),
      certificateArn: this.domainCertificate.certificateArn,
      description: `Interview Bot Frontend API (${this.config.environmentName})`,
    });
    const appsyncApi = new appsync.GraphqlApi(this, this.config.generateLogicalId('gql'), {
      name: this.config.generateName('gql'),
      schema: appsync.SchemaFile.fromAsset(GraphQLSchemaFile),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.API_KEY,
          apiKeyConfig: {
            name: 'public',
            expires: Expiration.after(Duration.days(360)),
            description: 'Public access API key',
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: AuthorizationType.IAM,
          },
        ],
      },
      xrayEnabled: this.envConfig.enableXRay,
      logConfig: {
        fieldLogLevel: FieldLogLevel.ALL,
        retention: this.envConfig.logRetention,
      },
    });
    const appsyncAssociation = new appsync.CfnDomainNameApiAssociation(this, 'appsync-domain-assoc', {
      apiId: appsyncApi.apiId,
      domainName: appsyncDomainName.domainName,
    });
    appsyncAssociation.addDependency(appsyncDomainName);
    new route53.CnameRecord(this, 'gql-domain-record', {
      recordName: appsyncDomainName.domainName,
      zone: HostedZone.fromLookup(this, 'hosted-zone', { domainName: this.envConfig.hostedZone }),
      domainName: appsyncDomainName.attrAppSyncDomainName,
    });

    return appsyncApi;
  }
}

function patchStackConfig(config: StackConfig): StackConfig {
  const cfgInfra: InfraInitConfig = {
    ...config.infraConfig,
    projectName: `${ProjectName}-${InterviewBotProjectName}`,
  };
  return new StackConfig(config.app, config.environmentName, cfgInfra, config.stackName, {
    ...config.props,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  });
}

/**
 * Generic pipeline resolver to wrap js functions
 */
const passthrough = appsync.InlineCode.fromInline(
  `
  export function request(...args) {
    return {}
  }

  export function response(ctx) {
    return ctx.prev.result
  }
`.trim(),
);

interface CreateResolverOptions {
  /**
   * optional data source. Default is DDB data source
   */
  dataSource?: BaseDataSource;
  /**
   * optional file name. Default is `${type}.${field}.js`. Relative to graphql-resolvers/dist/ folder
   */
  fileName?: string;
  /**
   * Optional additional functions that will be added to the pipeline after the main one
   */
  additionalPipelineFns?: appsync.AppsyncFunction[];
}
