import { StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration, NestedStack, NestedStackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Effect, PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { AssetCode } from 'aws-cdk-lib/aws-lambda/lib/code';
import { LayerVersion } from 'aws-cdk-lib/aws-lambda/lib/layers';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { SqsDestination } from 'aws-cdk-lib/aws-s3-notifications';
import * as sns from 'aws-cdk-lib/aws-sns';
import { IQueue, Queue } from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import * as path from 'path';
import { generateStackResourceName, isPreview } from '../../config/environments';
import { PROJECT_ROOT_PATH } from '../../config/paths';
import { EnvironmentType, openAiSecretName, secretAccess, ssmPolicy } from '../../utils/lambda-helpers';
import { OpenSearchConstruct } from '../../utils/opensearch-construct';
import { pEnv } from './config';

export interface OpenSearchStackProps extends NestedStackProps {
  config: StackConfig;
  ssmParameters: {
    config: string[];
    serviceAccount: string[];
  };
  athenaDb: string;
  athenaOutputLocation: string;
  failureTopic?: sns.ITopic;
  envType: EnvironmentType;
}

export class OpenSearchStack extends NestedStack {
  props: OpenSearchStackProps;
  indexCandidatesLambda: lambda.Function;
  indexCandidateInfoLambda: lambda.Function;
  indexResumeLambda: lambda.Function;
  indexBfqsLambda: lambda.Function;
  resumeIndexingQueue: IQueue;
  bfqsIndexingQueue: IQueue;
  bfqBucket: s3.Bucket;
  reindexCandidatesLambda: lambda.Function;
  reindexStateMachine: sfn.StateMachine;
  migrateResumesLambda: lambda.Function;
  simpleStateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: OpenSearchStackProps) {
    super(scope, id, props);
    this.props = props;

    const indexResumeLambdaTimeoutSeconds = 60;
    const sqsMaxReceiveCount = 6;

    const resumesBucket = new s3.Bucket(this, 'resumes', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketName: this.props.config.generateName('resumes'),
      versioned: true,
      autoDeleteObjects: isPreview(props.config.environmentName) ? true : undefined,
      removalPolicy: isPreview(props.config.environmentName) ? RemovalPolicy.DESTROY : undefined,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });
    resumesBucket.addLifecycleRule({
      id: 'DeleteOldVersions',
      prefix: '',
      tagFilters: [],
      transitions: [],
      noncurrentVersionExpiration: Duration.days(180),
    });

    // BFQs bucket
    this.bfqBucket = new s3.Bucket(this, 'bfq', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: this.props.config.generateName('bfq'),
      versioned: true,
      autoDeleteObjects: isPreview(props.config.environmentName) ? true : undefined,
      removalPolicy: isPreview(props.config.environmentName) ? RemovalPolicy.DESTROY : undefined,
    });
    this.bfqBucket.addLifecycleRule({
      id: 'DeleteOldVersions',
      prefix: 'answers/',
      tagFilters: [],
      transitions: [],
      noncurrentVersionExpiration: Duration.days(365),
    });

    const collectionName = 'search';
    const osCollection = new OpenSearchConstruct(this, collectionName, {
      config: props.config,
      name: collectionName,
      type: 'SEARCH',
    });

    // OpenSearch collection for vector search
    const osVectorSearchCollectionName = 'vector-search';
    const osVectorSearchCollection = new OpenSearchConstruct(this, osVectorSearchCollectionName, {
      config: props.config,
      name: osVectorSearchCollectionName,
      type: 'VECTORSEARCH',
    });

    const projectPath = path.join(PROJECT_ROOT_PATH, 'open-search');
    const layerPath = path.resolve(projectPath, 'dist/layer');
    const codePath = path.resolve(projectPath, 'dist/code');
    // Create lambda layer with node_modules
    const modulesLayer = new lambda.LayerVersion(this, 'node_modules_layer', {
      code: Code.fromAsset(layerPath),
      compatibleRuntimes: [Runtime.NODEJS_16_X, Runtime.NODEJS_18_X],
    });

    const defaultLambdaProps = {
      runtime: Runtime.NODEJS_16_X,
      layers: [modulesLayer],
      code: Code.fromAsset(codePath),
    };

    const deadLetterQueueName = generateStackResourceName(props.config, 'resume-indexing-dead-letter-queue');
    const deadLetterQueue = new Queue(this, deadLetterQueueName, {
      queueName: deadLetterQueueName,
    });

    const queueName = generateStackResourceName(props.config, 'resume-indexing-queue');
    this.resumeIndexingQueue = new Queue(this, queueName, {
      queueName,
      visibilityTimeout: Duration.seconds(indexResumeLambdaTimeoutSeconds * 6),
      deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: sqsMaxReceiveCount },
    });

    this.initBfqsIndexingQueue();

    const environment = {
      ENV: props.config.environmentName,
      COLLECTION_ENDPOINT: osCollection.collectionEndpoint,
      VECTOR_SEARCH_COLLECTION_ENDPOINT: osVectorSearchCollection.collectionEndpoint,
      ATHENA_DB: props.athenaDb,
      ATHENA_OUTPUT_LOCATION: props.athenaOutputLocation,
      SSM_PARAMETER_CONFIG: props.ssmParameters.config.join(','),
      SSM_PARAMETER_SERVICE_ACCOUNT: props.ssmParameters.serviceAccount.join(','),
      RESUME_INDEX_QUEUE_URL: `${this.resumeIndexingQueue.queueUrl}`,
      BFQS_INDEX_QUEUE_URL: `${this.bfqsIndexingQueue.queueUrl}`,
      RESUME_BUCKET_NAME: resumesBucket.bucketName,
      OPENAI_SECRET_NAME: openAiSecretName(this.props.envType),
    };

    this.indexCandidatesLambda = new lambda.Function(this, 'index-candidates', {
      ...defaultLambdaProps,
      functionName: generateStackResourceName(props.config, 'index-candidates'),
      handler: 'index-candidates/index.handler',
      timeout: Duration.minutes(10),
      memorySize: 10240,
      environment,
    });
    this.addPermissionsToLambda(this.indexCandidatesLambda);
    osCollection.dataAccessPolicy('1-candidates', this.indexCandidatesLambda);
    osVectorSearchCollection.dataAccessPolicy('1a-candidates-vector-search', this.indexCandidatesLambda);

    this.indexCandidateInfoLambda = new lambda.Function(this, 'index-candidate-info', {
      ...defaultLambdaProps,
      functionName: generateStackResourceName(props.config, 'index-candidate-info'),
      handler: 'index-candidate-info/index.handler',
      timeout: Duration.minutes(10),
      memorySize: 2048,
      environment,
      onFailure: this.props.failureTopic ? new destinations.SnsDestination(this.props.failureTopic) : undefined,
    });
    this.addPermissionsToLambda(this.indexCandidateInfoLambda);

    this.indexResumeLambda = new lambda.Function(this, 'index-resume', {
      ...defaultLambdaProps,
      runtime: Runtime.NODEJS_18_X,
      functionName: generateStackResourceName(props.config, 'index-resume'),
      handler: 'index-resume/index.handler',
      timeout: Duration.seconds(indexResumeLambdaTimeoutSeconds),
      memorySize: 1024,
      environment,
      onFailure: this.props.failureTopic ? new destinations.SnsDestination(this.props.failureTopic) : undefined,
    });
    this.addPermissionsToLambda(this.indexResumeLambda);

    osCollection.dataAccessPolicy('2-candidate-info', this.indexCandidateInfoLambda);
    osVectorSearchCollection.dataAccessPolicy('2a-candidate-vector-search', this.indexCandidateInfoLambda);

    this.indexResumeLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: Effect.ALLOW,
        resources: [`${resumesBucket.bucketArn}/*`],
        actions: ['s3:GetObject'],
      }),
    );
    this.indexResumeLambda.addToRolePolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['bedrock:InvokeModel'],
      }),
    );

    osCollection.dataAccessPolicy('3-candidate-resume', this.indexResumeLambda);
    osVectorSearchCollection.dataAccessPolicy('3a-candidate-vector-search', this.indexResumeLambda);

    this.indexResumeLambda.addToRolePolicy(secretAccess(openAiSecretName(this.props.envType)));

    this.reindexCandidatesLambda = new lambda.Function(this, 'reindex-candidates', {
      ...defaultLambdaProps,
      functionName: generateStackResourceName(props.config, 'reindex-candidates'),
      handler: 'reindex-candidates/index.handler',
      timeout: Duration.minutes(10),
      memorySize: 1024,
      environment,
    });
    this.addPermissionsToLambda(this.reindexCandidatesLambda);
    osCollection.dataAccessPolicy('4-reindex-candidates', this.reindexCandidatesLambda);
    osVectorSearchCollection.dataAccessPolicy('4a-reindex-candidates-vector-search', this.reindexCandidatesLambda);

    this.reindexStateMachine = this.createReindexStateMachine();

    this.resumeIndexingQueue.addToResourcePolicy(
      new PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [`${this.resumeIndexingQueue.queueArn}`],
        principals: [new ServicePrincipal('s3.amazonaws.com')],
        conditions: {
          ArnEquals: {
            'aws:SourceArn': `${resumesBucket.bucketArn}`,
          },
        },
      }),
    );

    this.resumeIndexingQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['sqs:*'],
        resources: [`${this.resumeIndexingQueue.queueArn}`],
        principals: [new iam.ServicePrincipal('lambda.amazonaws.com')],
        effect: iam.Effect.ALLOW,
        conditions: {
          ArnEquals: { 'aws:SourceArn': this.indexCandidatesLambda.functionArn },
        },
      }),
    );

    this.indexResumeLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [`${this.resumeIndexingQueue.queueArn}`],
        actions: ['sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ReceiveMessage'],
      }),
    );

    const sqsDestination = new SqsDestination(this.resumeIndexingQueue);
    resumesBucket.addObjectCreatedNotification(sqsDestination);
    resumesBucket.addObjectRemovedNotification(sqsDestination);

    const eventSource = new SqsEventSource(this.resumeIndexingQueue);
    this.indexResumeLambda.addEventSource(eventSource);

    this.createBFQProcessingArtifacts(this.props, osCollection, osVectorSearchCollection, defaultLambdaProps);

    this.migrateResumesLambda = new lambda.Function(this, 'migrate-resumes', {
      functionName: generateStackResourceName(props.config, 'migrate-resumes'),
      runtime: Runtime.NODEJS_16_X,
      handler: 'migrate-resumes/index.handler',
      layers: [modulesLayer],
      code: Code.fromAsset(codePath),
      timeout: Duration.minutes(10),
      memorySize: 1024,
      environment: {
        ENV: props.config.environmentName,
        RESUMES_BUCKET: resumesBucket.bucketName,
        ATHENA_DB: props.athenaDb,
        ATHENA_OUTPUT_LOCATION: props.athenaOutputLocation,
        SSM_PARAMETER_CONFIG: props.ssmParameters.config.join(','),
        SSM_PARAMETER_SERVICE_ACCOUNT: props.ssmParameters.serviceAccount.join(','),
      },
    });
    this.addPermissionsToLambda(this.migrateResumesLambda);
    this.migrateResumesLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:*'],
        resources: [`arn:aws:s3:::${resumesBucket.bucketName}/*`],
      }),
    );

    this.simpleStateMachine = this.createSimpleStateMachine();
  }

  private initBfqsIndexingQueue(): void {
    const { config } = this.props;

    const lambdaTimeoutSeconds = 60;
    const sqsMaxReceiveCount = 6;

    const deadLetterQueueName = generateStackResourceName(config, 'bfqs-indexing-dead-letter-queue');
    const deadLetterQueue = new Queue(this, deadLetterQueueName, {
      queueName: deadLetterQueueName,
    });

    const queueName = generateStackResourceName(config, 'bfqs-indexing-queue');
    this.bfqsIndexingQueue = new Queue(this, queueName, {
      queueName,
      visibilityTimeout: Duration.seconds(lambdaTimeoutSeconds * 6),
      deliveryDelay: Duration.seconds(30),
      deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: sqsMaxReceiveCount },
    });
  }

  private createBFQProcessingArtifacts(
    props: OpenSearchStackProps,
    osCollection: OpenSearchConstruct,
    osVectorSearchCollection: OpenSearchConstruct,
    defaultLambdaProps: { runtime: Runtime; layers: LayerVersion[]; code: AssetCode },
  ): void {
    const { config } = this.props;

    this.indexBfqsLambda = new lambda.Function(this, 'index-bfqs', {
      ...defaultLambdaProps,
      functionName: generateStackResourceName(config, 'index-bfqs'),
      handler: 'index-bfq/index.handler',
      timeout: Duration.seconds(60),
      memorySize: 1024,
      environment: {
        ENV: props.config.environmentName,
        COLLECTION_ENDPOINT: osCollection.collectionEndpoint,
        VECTOR_SEARCH_COLLECTION_ENDPOINT: osVectorSearchCollection.collectionEndpoint,
        ATHENA_DB: props.athenaDb,
        ATHENA_OUTPUT_LOCATION: props.athenaOutputLocation,
        SSM_PARAMETER_CONFIG: props.ssmParameters.config.join(','),
        SSM_PARAMETER_SERVICE_ACCOUNT: props.ssmParameters.serviceAccount.join(','),
        BFQS_BUCKET_NAME: this.bfqBucket.bucketName,
      },
      onFailure: this.props.failureTopic ? new destinations.SnsDestination(this.props.failureTopic) : undefined,
    });

    this.indexBfqsLambda.addToRolePolicy(ssmPolicy(this.props.config.environmentName));
    this.indexBfqsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [`${this.bfqsIndexingQueue.queueArn}`],
        actions: ['sqs:SendMessage'],
      }),
    );

    osCollection.dataAccessPolicy('candidate-bfqs', this.indexBfqsLambda);
    osVectorSearchCollection.dataAccessPolicy('5-candidate-bfqs', this.indexBfqsLambda);

    const eventSource = new SqsEventSource(this.bfqsIndexingQueue);
    this.indexBfqsLambda.addEventSource(eventSource);

    this.indexBfqsLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: Effect.ALLOW,
        resources: [`${this.bfqBucket.bucketArn}/**`],
        actions: ['s3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject'],
      }),
    );

    this.bfqsIndexingQueue.addToResourcePolicy(
      new PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [`${this.bfqsIndexingQueue.queueArn}`],
        principals: [new ServicePrincipal('s3.amazonaws.com')],
        conditions: {
          ArnEquals: {
            'aws:SourceArn': this.bfqBucket.bucketArn,
          },
        },
      }),
    );

    this.bfqsIndexingQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [`${this.bfqsIndexingQueue.queueArn}`],
        principals: [new ServicePrincipal('lambda.amazonaws.com')],
        effect: iam.Effect.ALLOW,
        conditions: {
          ArnEquals: { 'aws:SourceArn': this.indexCandidatesLambda.functionArn },
        },
      }),
    );

    const sqsDestination = new SqsDestination(this.bfqsIndexingQueue);
    this.bfqBucket.addObjectCreatedNotification(sqsDestination);
    this.bfqBucket.addObjectRemovedNotification(sqsDestination);
  }

  private addPermissionsToLambda(func: lambda.Function) {
    func.addToRolePolicy(ssmPolicy(this.props.config.environmentName));
    func.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [
          `arn:aws:s3:::xo-${pEnv(this.props.config.environmentName)}-athena-query-results*`,
          `arn:aws:s3:::xo-hiring-${pEnv(this.props.config.environmentName)}-stats-tracker*`,
        ],
        actions: ['s3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject'],
      }),
    );
    func.addToRolePolicy(
      new iam.PolicyStatement({
        resources: [`${this.resumeIndexingQueue.queueArn}`, `${this.bfqsIndexingQueue.queueArn}`],
        actions: ['sqs:*'],
      }),
    );
    func.role?.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonAthenaFullAccess'));
  }

  private createReindexStateMachine(): sfn.StateMachine {
    const succeed = new sfn.Succeed(this, 'ReindexingSucceeded');

    const startReindexing = new tasks.LambdaInvoke(this, 'StartReindexing', {
      lambdaFunction: this.reindexCandidatesLambda,
      payloadResponseOnly: true,
    });
    const continueReindexing = new tasks.LambdaInvoke(this, 'ContinueReindexing', {
      lambdaFunction: this.reindexCandidatesLambda,
      payloadResponseOnly: true,
    });

    const isReindexingCompleted = new sfn.Choice(this, 'IsReindexingCompleted')
      .when(sfn.Condition.isPresent('$.searchAfter'), continueReindexing)
      .otherwise(succeed);
    continueReindexing.next(isReindexingCompleted);

    const definition = startReindexing.next(isReindexingCompleted);

    return new sfn.StateMachine(this, 'reindex-state-machine', {
      stateMachineName: this.props.config.generateName('reindex-state-machine'),
      definition,
    });
  }

  private createSimpleStateMachine(): sfn.StateMachine {
    const succeed = new sfn.Succeed(this, 'Succeed');

    const migrateResumes = new tasks.LambdaInvoke(this, 'MigrateResumes', {
      lambdaFunction: this.migrateResumesLambda,
      payload: sfn.TaskInput.fromObject({
        migrateResumeStartDate: sfn.JsonPath.stringAt('$.migrateResumeStartDate'),
        migrateResumeEndDate: sfn.JsonPath.stringAt('$.migrateResumeEndDate'),
      }),
      payloadResponseOnly: true,
    });
    const migrateResumesRemaining = new tasks.LambdaInvoke(this, 'MigrateResumesRemaining', {
      lambdaFunction: this.migrateResumesLambda,
      payloadResponseOnly: true,
    });

    const isMigrateResumesComplete = new sfn.Choice(this, 'IsMigrateResumesComplete')
      .when(sfn.Condition.isPresent('$.nextToken'), migrateResumesRemaining)
      .otherwise(succeed);
    migrateResumesRemaining.next(isMigrateResumesComplete);

    const definition = migrateResumes.next(isMigrateResumesComplete);

    return new sfn.StateMachine(this, 'simple-state-machine', {
      stateMachineName: this.props.config.generateName('simple-state-machine'),
      definition,
    });
  }
}
