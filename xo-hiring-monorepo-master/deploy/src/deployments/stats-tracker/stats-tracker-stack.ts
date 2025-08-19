import { Deployment, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { CfnOutput, Duration } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import { Schedule } from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { generateStackResourceName, isPreview } from '../../config/environments';
import { Project, StatsTrackerConfig } from './config';
import { OpenSearchStack } from './open-search-stack';
import { ProjectStructure } from './paths';
import { StatsTrackerGlueStack } from './stats-tracker-glue-stack';
import { StatsTrackerStateMachineStack } from './stats-tracker-state-machine-stack';
import { DynamoDBAthenaSyncStack } from './dynamodb-athena-sync-stack';

@Deployment(Project.name, Project.name)
export class StatsTrackerStack extends RootStack {
  constructor(config: StackConfig, env: StatsTrackerConfig) {
    super(config);

    // backup bucket (configured as an Endpoint in OwnBackup)
    let bucket: s3.IBucket;
    if (env.envOverrides) {
      bucket = s3.Bucket.fromBucketName(this, 'ownbackup-bucket', env.envOverrides.backupBucketName);
    } else {
      const newBucket = new s3.Bucket(this, 'ownbackup-bucket', {
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        bucketName: generateStackResourceName(config, 'ownbackup-bucket'),
      });
      const ownbackupUser = iam.User.fromUserName(this, 'ownbackup-user', env.ownbackupUserName);
      const acc921977433868 = new iam.AccountPrincipal('921977433868');
      newBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ['s3:*'],
          principals: [ownbackupUser],
          resources: [newBucket.bucketArn, newBucket.arnForObjects('*')],
        }),
      );
      newBucket.addToResourcePolicy(
        new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:ListBucket'],
          principals: [acc921977433868],
          resources: [newBucket.bucketArn, newBucket.arnForObjects('*')],
        }),
      );
      // delete old backups
      newBucket.addLifecycleRule({
        prefix: 'backup/',
        expiration: Duration.days(3),
      });
      bucket = newBucket;
    }

    new CfnOutput(this, 'ownbackup-bucket-name', {
      value: bucket.bucketName,
    });

    // secrets
    const ownbackupSecret = this.createOwnbackupSecrets(config, env);
    const trSecret = this.createTrackerRefresherSecrets(config, env);
    const kontentExporterSecret = this.createKontentExporterSecrets(config, env);

    const stateMachineId = 'state-machine';
    const stateMachineName = generateStackResourceName(config, stateMachineId);

    // failure topic
    const failureTopic = env.failureSNSArn
      ? sns.Topic.fromTopicArn(this, 'failure-topic', env.failureSNSArn)
      : undefined;

    // lambdas
    const ownBackUpExporterLambda = this.createOwnBackupExporterLambda(
      config,
      ownbackupSecret,
      stateMachineName,
      failureTopic,
    );
    const trackerRefresherLambda = this.createTrackerRefresherLambda(config, env, trSecret, failureTopic);

    const kontentExporterLambda = this.createKontentExporterLambda(config, env, kontentExporterSecret, failureTopic);

    // Glue
    const glueStack = new StatsTrackerGlueStack(this, 'glue-stack', config, {
      bucket: bucket,
      crawlerRoleName: env.glue.crawlerRoleName,
    });

    const openSearchStack = new OpenSearchStack(this, 'open-search', {
      config: config,
      ssmParameters: {
        config: env.openSearch.getSsmConfigParameter(config.environmentName),
        serviceAccount: env.openSearch.getSsmServiceAccountParameter(config.environmentName),
      },
      athenaDb: env.openSearch.getAthenaDb(config.environmentName),
      athenaOutputLocation: env.openSearch.getAthenaOutputLocation(config.environmentName),
      failureTopic,
      envType: env.envType,
    });

    // Add DynamoDB to Athena sync stack
    const dynamoDBSyncStack = new DynamoDBAthenaSyncStack(this, 'dynamodb-sync-stack', {
      config: config,
      bucket: bucket,
      crawlerRoleName: env.glue.crawlerRoleName,
      athenaDb: env.openSearch.getAthenaDb(config.environmentName),
      athenaOutputLocation: env.openSearch.getAthenaOutputLocation(config.environmentName),
      tableMappings: env.ddbToAthenaSync.tableMappings,
    });

    // state machine
    if (!glueStack.job.name || !glueStack.crawler.name) {
      throw new Error();
    }
    const stateMachineStack = new StatsTrackerStateMachineStack(this, 'state-machine-stack', {
      stateMachineName,
      stateMachineId,
      ownBackUpExporterLambda,
      trackerRefresherLambda,
      kontentExporterLambda,
      indexCandidatesLambda: openSearchStack.indexCandidatesLambda,
      indexCandidateInfoLambda: openSearchStack.indexCandidateInfoLambda,
      glueJobName: glueStack.job.name,
      glueCrawlerName: glueStack.crawler.name,
      ddbSyncStateMachine: dynamoDBSyncStack.stateMachine,
    });

    if (!isPreview(config.environmentName)) {
      this.setupCron(config, stateMachineStack.stateMachine);
    }

    if (failureTopic) {
      this.setupNotifications(config, stateMachineStack.stateMachine, failureTopic);
    }
  }

  private createOwnbackupSecrets(config: StackConfig, env: StatsTrackerConfig): secretsmanager.ISecret {
    const secretId = 'ownbackup-secret';
    if (env.envOverrides) {
      return secretsmanager.Secret.fromSecretNameV2(this, secretId, env.envOverrides.ownbackupSecretName);
    }
    const secretName = generateStackResourceName(config, secretId);
    return new secretsmanager.Secret(this, secretId, {
      secretName,
      description: `Secrets for the ${Project.name} (V2), env: ${config.environmentName}`,
    });
  }

  private createOwnBackupExporterLambda(
    config: StackConfig,
    ownbackupSecret: secretsmanager.ISecret,
    stateMachineName: string,
    failureTopic?: sns.ITopic,
  ): lambda.Function {
    const lambdaId = 'ownbackup-exporter';
    const layerId = 'ownbackup-exporter-node-modules-layer';

    const lambdaFunc = new lambda.Function(this, lambdaId, {
      functionName: generateStackResourceName(config, lambdaId),
      code: lambda.Code.fromAsset(ProjectStructure.ownbackupExporterLambdaDistCode),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.minutes(1),
      layers: [
        new lambda.LayerVersion(this, layerId, {
          layerVersionName: generateStackResourceName(config, layerId),
          code: lambda.Code.fromAsset(ProjectStructure.ownbackupExporterLambdaDistLayer),
          compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
        }),
      ],
      onFailure: failureTopic ? new destinations.SnsDestination(failureTopic) : undefined,
      environment: {
        SECRETS_KEY: ownbackupSecret.secretName,
        STATE_MACHINE_NAME: stateMachineName,
      },
    });

    lambdaFunc.addToRolePolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['states:ListStateMachines', 'states:ListExecutions'],
      }),
    );

    lambdaFunc.addToRolePolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['secretsmanager:GetSecretValue'],
      }),
    );
    return lambdaFunc;
  }

  private createTrackerRefresherSecrets(config: StackConfig, env: StatsTrackerConfig): secretsmanager.ISecret {
    const secretId = 'tracker-refresher-secret';
    if (env.envOverrides) {
      return secretsmanager.Secret.fromSecretNameV2(this, secretId, env.envOverrides.trackerGeneratorSecretName);
    }
    const secretName = generateStackResourceName(config, secretId);
    return new secretsmanager.Secret(this, secretId, {
      secretName,
      description: `Secrets for the ${Project.name} (V2), env: ${config.environmentName}`,
    });
  }

  private createTrackerRefresherLambda(
    config: StackConfig,
    env: StatsTrackerConfig,
    secret: secretsmanager.ISecret,
    failureTopic?: sns.ITopic,
  ): lambda.Function {
    const lambdaId = 'tracker-refresher';
    const layerId = 'tracker-refresher-node-modules-layer';

    const lambdaEnv: Record<string, string> = {
      SECRETS_KEY: secret.secretName,
      TARGET_TITLE_PREFIX: env.trackerTarget.titlePrefix(config.environmentName),
    };
    if (env.trackerTarget.spreadsheetId) {
      lambdaEnv.TARGET_SPREADSHEET_ID = env.trackerTarget.spreadsheetId;
    }
    if (env.trackerTarget.sheetId) {
      lambdaEnv.TARGET_SHEET_ID = env.trackerTarget.sheetId;
    }

    const lambdaFunc = new lambda.Function(this, lambdaId, {
      functionName: generateStackResourceName(config, lambdaId),
      code: lambda.Code.fromAsset(ProjectStructure.trackerRefresherLambdaDistCode),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      // From real run: Max Memory Used: 2260 MB
      memorySize: 3072,
      timeout: Duration.minutes(10),
      layers: [
        new lambda.LayerVersion(this, layerId, {
          layerVersionName: generateStackResourceName(config, layerId),
          code: lambda.Code.fromAsset(ProjectStructure.trackerRefresherLambdaDistLayer),
          compatibleRuntimes: [lambda.Runtime.NODEJS_16_X],
        }),
      ],
      onFailure: failureTopic ? new destinations.SnsDestination(failureTopic) : undefined,
      environment: lambdaEnv,
    });

    lambdaFunc.addToRolePolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['secretsmanager:GetSecretValue'],
      }),
    );

    lambdaFunc.addToRolePolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['athena:*', 'glue:*', 's3:*'],
      }),
    );

    return lambdaFunc;
  }

  private createKontentExporterSecrets(config: StackConfig, env: StatsTrackerConfig): secretsmanager.ISecret {
    const secretId = 'kontent-export-secret';
    if (env.envOverrides) {
      return secretsmanager.Secret.fromSecretNameV2(this, secretId, env.envOverrides.kontentExporterSecretName);
    }
    const secretName = generateStackResourceName(config, secretId);
    return new secretsmanager.Secret(this, secretId, {
      secretName,
      description: `Secrets for the ${Project.name} , env: ${config.environmentName}`,
    });
  }

  private createKontentExporterLambda(
    config: StackConfig,
    env: StatsTrackerConfig,
    secret: secretsmanager.ISecret,
    failureTopic?: sns.ITopic,
  ): lambda.Function {
    const lambdaId = 'kontent-exporter';
    const layerId = 'kontent-exporter-node-modules-layer';

    const lambdaEnv: Record<string, string> = {
      SECRETS_KEY: secret.secretName,
    };

    const lambdaFunc = new lambda.Function(this, lambdaId, {
      functionName: generateStackResourceName(config, lambdaId),
      code: lambda.Code.fromAsset(ProjectStructure.kontentExporterLambdaDistCode),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1280,
      timeout: Duration.seconds(200),
      layers: [
        new lambda.LayerVersion(this, layerId, {
          layerVersionName: generateStackResourceName(config, layerId),
          code: lambda.Code.fromAsset(ProjectStructure.kontentExporterLambdaDistLayer),
          compatibleRuntimes: [lambda.Runtime.NODEJS_16_X],
        }),
      ],
      onFailure: failureTopic ? new destinations.SnsDestination(failureTopic) : undefined,
      environment: lambdaEnv,
    });

    lambdaFunc.addToRolePolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['secretsmanager:GetSecretValue'],
      }),
    );

    lambdaFunc.addToRolePolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['athena:*', 'glue:*', 's3:*'],
      }),
    );

    return lambdaFunc;
  }

  private setupNotifications(config: StackConfig, stateMachine: sfn.StateMachine, failureTopic: sns.ITopic) {
    const ruleId = 'state-machine-failures';
    new events.Rule(this, ruleId, {
      ruleName: generateStackResourceName(config, ruleId),
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          status: ['FAILED'],
          stateMachineArn: [stateMachine.stateMachineArn],
        },
      },
      targets: [new targets.SnsTopic(failureTopic)],
    });
  }

  private setupCron(config: StackConfig, stateMachine: sfn.StateMachine): events.Rule {
    const ruleId = 'state-machine-cron';
    return new events.Rule(this, ruleId, {
      ruleName: generateStackResourceName(config, ruleId),
      schedule: Schedule.cron({
        // Run at 7:00 UTC every day
        minute: '0',
        hour: '7',
        day: '*',
        month: '*',
        year: '*',
      }),
      targets: [new targets.SfnStateMachine(stateMachine)],
    });
  }
}
