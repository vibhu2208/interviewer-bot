import { Duration, NestedStack, NestedStackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import { Construct } from 'constructs';
import { StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { PROJECT_ROOT_PATH } from '../../config/paths';
import { generateStackResourceName } from '../../config/environments';
import { secretAccess, ssmPolicy } from '../../utils/lambda-helpers';
import { SfApiEnvironmentConfiguration } from './sf-api-config';

interface AiDataStackProps extends NestedStackProps {
  stackConfig: StackConfig;
  config: SfApiEnvironmentConfiguration;
}

export class AiDataStack extends NestedStack {
  public readonly aiDataTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: AiDataStackProps) {
    super(scope, id, props);

    // DynamoDB Table
    this.aiDataTable = new dynamodb.Table(this, 'ai-data-table', {
      tableName: generateStackResourceName(props.stackConfig, 'ai-data'),
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Lambda Layer and Code
    const projectPath = path.join(PROJECT_ROOT_PATH, 'api-proxy');
    const layerPath = path.resolve(projectPath, 'dist/layer');
    const codePath = path.resolve(projectPath, 'dist/code');

    const modulesLayer = new lambda.LayerVersion(this, 'ai-data-lambda-layer', {
      code: lambda.Code.fromAsset(layerPath),
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
    });
    const code = lambda.Code.fromAsset(codePath);

    // Spotlight Summary Generator Lambda
    const spotlightSummaryLambda = new lambda.Function(this, 'ai-data-spotlight-generator-lambda', {
      functionName: generateStackResourceName(props.stackConfig, 'spotlight-summary-generator'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'ai-data/spotlight-summary-generator.handler',
      layers: [modulesLayer],
      code: code,
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: {
        ENV: props.stackConfig.environmentName,
        KONTENT_SECRET_NAME: props.config.kontentSecretName,
        AI_DATA_TABLE_NAME: this.aiDataTable.tableName,
        IB_TABLE_NAME: props.config.interviewBotTableName,
        INTERVIEW_BOT_API_URL: props.config.interviewBotApiUrl(props.stackConfig.environmentName),
        PROMPTLENS_SECRET_NAME: props.config.promptLensSecretName,
      },
    });

    const applyEmailContentGeneratorLambda = new lambda.Function(this, 'ai-data-apply-email-generator-lambda', {
      functionName: generateStackResourceName(props.stackConfig, 'apply-email-content-generator'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'ai-data/apply-email-content-generator.handler',
      layers: [modulesLayer],
      code: code,
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: {
        ENV: props.stackConfig.environmentName,
        KONTENT_SECRET_NAME: props.config.kontentSecretName,
        AI_DATA_TABLE_NAME: this.aiDataTable.tableName,
        IB_TABLE_NAME: props.config.interviewBotTableName,
        S3_BUCKET_RESUMES: props.stackConfig.generateName('resumes'),
      },
    });

    applyEmailContentGeneratorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:ListBucket', 's3:ListBucketVersions', 's3:GetBucketLocation', 's3:Get*'],
        resources: ['arn:aws:s3:::*-resumes', 'arn:aws:s3:::*-resumes/*'],
      }),
    );

    // DDB Stream Lambda
    const ddbStreamLambda = new lambda.Function(this, 'ai-data-stream-handler', {
      functionName: generateStackResourceName(props.stackConfig, 'ai-data-stream'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'ai-data/ddb-stream-handler.handler',
      layers: [modulesLayer],
      code: code,
      timeout: Duration.seconds(30),
      memorySize: 1024,
      environment: {
        ENV: props.stackConfig.environmentName,
        SPOTLIGHT_LAMBDA_NAME: spotlightSummaryLambda.functionName,
        APPLY_EMAIL_LAMBDA_NAME: applyEmailContentGeneratorLambda.functionName,
      },
    });

    // Add DynamoDB stream as event source for the lambda
    ddbStreamLambda.addEventSource(
      new DynamoEventSource(this.aiDataTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 100,
        maxBatchingWindow: Duration.seconds(5),
        retryAttempts: 3,
      }),
    );

    // Grant read/write permissions to the lambdas
    dynamodb.Table.fromTableName(this, 'ib-ddb-table', props.config.interviewBotTableName).grantReadData(
      spotlightSummaryLambda,
    );

    this.aiDataTable.grantReadWriteData(ddbStreamLambda);
    this.aiDataTable.grantReadWriteData(spotlightSummaryLambda);
    this.aiDataTable.grantReadWriteData(applyEmailContentGeneratorLambda);

    spotlightSummaryLambda.grantInvoke(ddbStreamLambda);
    spotlightSummaryLambda.addToRolePolicy(secretAccess(props.config.kontentSecretName));
    spotlightSummaryLambda.addToRolePolicy(secretAccess(props.config.promptLensSecretName));
    spotlightSummaryLambda.addToRolePolicy(ssmPolicy(props.stackConfig.environmentName));

    applyEmailContentGeneratorLambda.grantInvoke(ddbStreamLambda);
    applyEmailContentGeneratorLambda.addToRolePolicy(secretAccess(props.config.kontentSecretName));
    applyEmailContentGeneratorLambda.addToRolePolicy(ssmPolicy(props.stackConfig.environmentName));

    if (props.stackConfig.environmentName.startsWith('pr')) {
      // Add SSM permissions for sandbox vars when running preview envs
      spotlightSummaryLambda.addToRolePolicy(ssmPolicy('sandbox'));
      applyEmailContentGeneratorLambda.addToRolePolicy(ssmPolicy('sandbox'));
    }

    const bedrockModelInvokePolicy = new iam.PolicyStatement({
      resources: ['*'],
      actions: ['bedrock:InvokeModel'],
    });

    spotlightSummaryLambda.addToRolePolicy(bedrockModelInvokePolicy);
    applyEmailContentGeneratorLambda.addToRolePolicy(bedrockModelInvokePolicy);
  }
}
