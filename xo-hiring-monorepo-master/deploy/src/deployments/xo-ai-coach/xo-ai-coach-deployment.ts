import * as util from '@aws-sdk/util-arn-parser';
import { Deployment, InfraInitConfig, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as path from 'path';
import { AWSAccount, AWSRegion, ProjectName } from '../../config/environments';
import {
  XoAiCoachBackendStackName,
  XoAiCoachConfiguration,
  XoAiCoachLambdaProject,
  XoAiCoachProjectName,
} from './xo-ai-coach-configuration';

@Deployment(XoAiCoachProjectName, XoAiCoachBackendStackName)
export class XoAiCoachStack extends RootStack {
  private readonly lambdaRole: iam.Role;
  private readonly lambdaCode: lambda.AssetCode;
  private readonly lambdaModules: lambda.LayerVersion;
  private readonly dataBucket: s3.Bucket;
  private readonly sourceBucket: s3.IBucket;

  constructor(config: StackConfig, private envConfig: XoAiCoachConfiguration) {
    super(patchStackConfig(config));

    // Bucket for batch reports
    this.dataBucket = new s3.Bucket(this, 'xo-ai-coach-data-bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      bucketName: this.config.generateName('data'),
      autoDeleteObjects: this.envConfig.removalPolicy == RemovalPolicy.DESTROY,
      removalPolicy: this.envConfig.removalPolicy,
    });

    this.lambdaCode = lambda.Code.fromAsset(path.join(XoAiCoachLambdaProject, 'dist/code'));
    this.lambdaModules = new lambda.LayerVersion(this, this.config.generateLogicalId('lambda-layer'), {
      code: lambda.Code.fromAsset(path.join(XoAiCoachLambdaProject, 'dist/layer')),
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
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonAthenaFullAccess'));
    this.lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSESFullAccess'));
    this.dataBucket.grantReadWrite(this.lambdaRole);
    this.lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        resources: [
          util.build({
            service: 'secretsmanager',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `secret:${envConfig.xoManageIntegrationUserSecret}-??????`,
          }),
          util.build({
            service: 'secretsmanager',
            region: AWSRegion,
            accountId: AWSAccount,
            resource: `secret:${envConfig.mailosaurSecretName}-??????`,
          }),
        ],
        actions: ['secretsmanager:GetSecretValue'],
      }),
    );

    // Source data bucket (data written here by external account)
    this.sourceBucket = s3.Bucket.fromBucketArn(this, 'external-data-bucket', envConfig.sourceBucketArn);
    this.sourceBucket.grantReadWrite(this.lambdaRole);

    const fnGen = this.createLambda('generateAndSendStats');
    const fnGenUrl = fnGen.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.BUFFERED,
    });

    this.addOutput('SendWeeklyEmailsLambdaUrl', fnGenUrl.url);
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
        ENV: this.config.environmentName,
        DATA_BUCKET: this.dataBucket.bucketName,
        ATHENA_DB: this.envConfig.athenaDbName,
        ATHENA_TABLE: this.envConfig.athenaTableName,
        INTEGRATION_USER_SECRET: this.envConfig.xoManageIntegrationUserSecret,
        MAILOSAUR_SECRET: this.envConfig.mailosaurSecretName,
        MOCK_EMAILS: `${this.envConfig.mockEmails}`,
        EMAIL_IDENTITY: this.envConfig.emailIdentity,
        EMAIL_CONFIGURATION_SET: this.envConfig.sesConfigurationSet,
      },
      timeout: Duration.minutes(15),
      role: this.lambdaRole,
      memorySize: 1024,
    });
  }
}

function patchStackConfig(config: StackConfig): StackConfig {
  const cfgInfra: InfraInitConfig = {
    ...config.infraConfig,
    projectName: `${ProjectName}-${XoAiCoachProjectName}`,
  };
  return new StackConfig(config.app, config.environmentName, cfgInfra, config.stackName, {
    ...config.props,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  });
}
