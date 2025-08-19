import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Duration } from 'aws-cdk-lib';
import { Schedule } from 'aws-cdk-lib/aws-events';

import { project } from './terminated-partners-config';
import {
  declareLambda,
  Deployment,
  InfraLambdaFunction,
  RootStack,
  StackConfig,
} from '@trilogy-group/lambda-cdk-infra';
import { EnvironmentConfiguration } from '../../config/model';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { AWSAccount, AWSRegion, isPreview } from '../../config/environments';

@Deployment(project.name, project.name)
export class TerminatedPartnersStack extends RootStack {
  constructor(stackConfig: StackConfig, envConfig: EnvironmentConfiguration) {
    stackConfig.props = {
      ...stackConfig.props,
      env: {
        account: AWSAccount,
        region: AWSRegion,
      },
    };
    super(stackConfig);

    const config = envConfig.terminatedPartners;

    const myVpc = ec2.Vpc.fromLookup(this, 'external-vpc', {
      vpcId: config.vpcId,
    });

    const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'external-security-group',
      config.securityGroupId,
    );

    // lambda
    const layerPath = path.resolve(project.path, 'dist/layer');
    const codePath = path.resolve(project.path, 'dist/code');
    // Create lambda layer with node_modules
    const modulesLayer = new LayerVersion(this, 'node_modules_layer', {
      code: Code.fromAsset(layerPath),
      compatibleRuntimes: [Runtime.NODEJS_18_X],
    });
    // This is assets with the lambda code
    const code = Code.fromAsset(codePath);

    // Now create lambdas
    const declaration = declareLambda('index.handler', {
      baseName: 'terminated-partners-v2',
      runtime: Runtime.NODEJS_18_X,
    });
    declaration.setFunction(
      InfraLambdaFunction.forRootStack(this, {
        ...declaration.props,
        handler: declaration.handler,
        layers: [modulesLayer],
        code,
        timeout: Duration.minutes(5),
        memorySize: 256,
        vpc: myVpc,
        vpcSubnets: { subnetFilters: [ec2.SubnetFilter.byIds(config.subnetIds)] },
        allowPublicSubnet: false,
        securityGroups: [securityGroup],
        runtime: Runtime.NODEJS_18_X,
      }),
    );

    declaration
      .fn()
      .addEnvironment('GOOGLE_ACCESS_CONFIG', config.GoogleServiceUser)
      .addEnvironment('DB_CONFIG', config.Db)
      .addEnvironment('APP_CONFIG', config.AppConfig);

    if (config.resources.length > 0) {
      const secretsPolicy = new iam.PolicyStatement();
      secretsPolicy.addResources(...config.resources);
      secretsPolicy.addActions('ssm:GetParametersByPath');
      secretsPolicy.addActions('ssm:GetParameters');
      secretsPolicy.addActions('ssm:GetParameter');
      secretsPolicy.effect = iam.Effect.ALLOW;
      declaration.fn().addToRolePolicy(secretsPolicy);
    }

    const ec2Policy = new iam.PolicyStatement({
      actions: [
        'ec2:DescribeNetworkInterfaces',
        'ec2:CreateNetworkInterface',
        'ec2:DeleteNetworkInterface',
        'ec2:DescribeInstances',
        'ec2:AttachNetworkInterface',
      ],
      resources: ['*'],
    });
    ec2Policy.effect = iam.Effect.ALLOW;
    declaration.fn().addToRolePolicy(ec2Policy);
    // permissions to invoke lambda
    declaration.fn().grantInvoke(new ServicePrincipal('apigateway.amazonaws.com'));

    // event rule
    if (!isPreview(stackConfig.environmentName)) {
      new events.Rule(this, this.generateName('rule'), {
        schedule: Schedule.expression('cron(0 7 * * ? *)'),
        targets: [new targets.LambdaFunction(declaration.fn(), {})],
      });
    }
  }
}
