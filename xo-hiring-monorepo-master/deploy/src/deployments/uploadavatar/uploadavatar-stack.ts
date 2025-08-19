import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { project, UploadAvatarConfig } from './uploadavatar-config';
import {
  declareLambda,
  Deployment,
  InfraLambdaFunction,
  RootStack,
  StackConfig,
} from '@trilogy-group/lambda-cdk-infra';

@Deployment(project.name, project.name)
export class UploadavatarStack extends RootStack {
  constructor(stackConfig: StackConfig, envConfig: UploadAvatarConfig) {
    super(stackConfig);

    // s3
    const uploadsBucket = s3.Bucket.fromBucketName(this, 'uploadsBucket', envConfig.bucketName);

    // lambda
    const layerPath = path.resolve(project.path, 'dist/layer');
    const codePath = path.resolve(project.path, 'dist/code');
    // Create lambda layer with node_modules
    const modulesLayer = new LayerVersion(this, 'node_modules_layer', {
      code: Code.fromAsset(layerPath),
      compatibleRuntimes: [Runtime.NODEJS_16_X],
    });
    // This is assets with the lambda code
    const code = Code.fromAsset(codePath);

    // Now create lambdas
    const declaration = declareLambda('index.handler', {
      baseName: 'uploadavatar-v2',
    });
    declaration.setFunction(
      InfraLambdaFunction.forRootStack(this, {
        ...declaration.props,
        handler: declaration.handler,
        layers: [modulesLayer],
        code,
        timeout: Duration.seconds(30),
        runtime: Runtime.NODEJS_16_X,
      }),
    );

    // permissions to upload
    const s3UploadAvatarPolicy = new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [uploadsBucket.arnForObjects('*')],
    });

    declaration.fn().addEnvironment('bucketName', uploadsBucket.bucketName).addToRolePolicy(s3UploadAvatarPolicy);

    // permissions to invoke lambda
    declaration.fn().grantInvoke(new ServicePrincipal('apigateway.amazonaws.com'));
  }
}
