import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as util from '@aws-sdk/util-arn-parser';
import { Code, FunctionProps, LayerVersion } from 'aws-cdk-lib/aws-lambda';
import { AWSAccount, AWSRegion, ProductionEnvName } from '../../config/environments';
import { Duration } from 'aws-cdk-lib';
import { project } from './sandbox-refresh-config';
import {
  declareLambda,
  DefaultInfraLambdaFunction,
  Deployment,
  InfraLambdaFunction,
  RootStack,
  StackConfig,
} from '@trilogy-group/lambda-cdk-infra';
import { EnvironmentConfiguration } from '../../config/model';
import { ssmPolicy } from '../../utils/lambda-helpers';

@Deployment(project.name, project.name)
export class SandboxRefreshStack extends RootStack {
  constructor(stackConfig: StackConfig, envConfig: EnvironmentConfiguration) {
    super(stackConfig);

    // lambda
    const layerPath = path.resolve(project.path, 'dist/layer');
    const codePath = path.resolve(project.path, 'dist/code');
    // Create lambda layer with node_modules
    const modulesLayer = new LayerVersion(this, 'node_modules_layer', {
      code: Code.fromAsset(layerPath),
      compatibleRuntimes: [(DefaultInfraLambdaFunction as FunctionProps).runtime],
    });
    // This is assets with the lambda code
    const code = Code.fromAsset(codePath);

    // Now create lambdas
    const declaration = declareLambda('index.handler', {
      baseName: 'sandbox-refresh-v2',
    });
    declaration.setFunction(
      InfraLambdaFunction.forRootStack(this, {
        ...declaration.props,
        handler: declaration.handler,
        layers: [modulesLayer],
        code,
        timeout: Duration.seconds(60),
      }),
    );

    // lambda permissions
    const secretArn = util.build({
      accountId: AWSAccount,
      region: AWSRegion,
      service: 'secretsmanager',
      resource: `secret:${envConfig.sandboxRefreshConfig.secretsKey}-??????`,
    });

    const secretsPolicy = new iam.PolicyStatement();
    secretsPolicy.addResources(secretArn);
    secretsPolicy.addActions('secretsmanager:GetSecretValue');
    secretsPolicy.addActions('secretsmanager:DescribeSecret');
    secretsPolicy.effect = iam.Effect.ALLOW;

    // always connect to production instance
    declaration.fn().addToRolePolicy(ssmPolicy(ProductionEnvName));

    declaration
      .fn()
      .addEnvironment('ENV', ProductionEnvName)
      .addEnvironment('SECRETS_KEY', envConfig.sandboxRefreshConfig.secretsKey)
      .addToRolePolicy(secretsPolicy);
  }
}
