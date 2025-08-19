import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { FargatePlatformVersion, LogDrivers } from 'aws-cdk-lib/aws-ecs';
import { ScheduledFargateTask } from 'aws-cdk-lib/aws-ecs-patterns';
import { Schedule } from 'aws-cdk-lib/aws-events';
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

import { AWSAccount, AWSRegion, generateStackResourceName, getSsmValue, isPreview } from '../../config/environments';

import { project, SiteRecacherConfig } from './site-recacher-config';

@Deployment(project.name, project.name)
export class SiteRecacherStack extends RootStack {
  constructor(stackConfig: StackConfig, config: SiteRecacherConfig) {
    stackConfig.props = {
      env: {
        account: AWSAccount,
        region: AWSRegion,
      },
    };
    super(stackConfig);

    const vpc = Vpc.fromLookup(this, 'vpc', {
      vpcId: config.fargateConfig.vpcId,
    });

    const cluster = new ecs.Cluster(this, 'cluster', {
      vpc,
      enableFargateCapacityProviders: true,
      containerInsights: true,
    });

    const roleName = generateStackResourceName(stackConfig, 'fargate-role');
    const fargateRole = new Role(this, roleName, {
      roleName,
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    fargateRole.addManagedPolicy(
      ManagedPolicy.fromManagedPolicyArn(
        this,
        'fargate-role',
        'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
      ),
    );

    fargateRole.addToPolicy(
      new PolicyStatement({
        actions: ['*'],
        resources: ['*'],
      }),
    );

    const fargateTaskDefinition = new ecs.FargateTaskDefinition(this, 'taskdef', {
      cpu: config.fargateConfig.cpu,
      memoryLimitMiB: config.fargateConfig.memoryLimitMiB,
      executionRole: fargateRole,
      taskRole: fargateRole,
    });

    fargateTaskDefinition.addContainer('container', {
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(this, 'ecr-repo', 'xo-hiring-site-recacher'),
      ),
      environment: {
        ENV: stackConfig.environmentName,
      },
      logging: LogDrivers.awsLogs({
        streamPrefix: generateStackResourceName(stackConfig, 'logs'),
      }),
    });

    if (!isPreview(stackConfig.environmentName)) {
      new ScheduledFargateTask(this, 'daily', {
        cluster,
        scheduledFargateTaskDefinitionOptions: {
          taskDefinition: fargateTaskDefinition,
        },
        schedule: Schedule.expression(getSsmValue(this, `${project.name}/schedulerExpression`)),
        platformVersion: FargatePlatformVersion.LATEST,
        subnetSelection: {
          subnetType: SubnetType.PUBLIC,
        },
      });
    }
  }
}
