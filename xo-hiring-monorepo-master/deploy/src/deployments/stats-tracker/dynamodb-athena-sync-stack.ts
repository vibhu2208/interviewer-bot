import { NestedStack, NestedStackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Duration } from 'aws-cdk-lib';
import { StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { ProjectStructure } from './paths';
import { AWSAccount, AWSRegion, generateStackResourceName } from '../../config/environments';

interface TableMapping {
  ddbTableName: string;
  athenaTableName: string;
}

interface DynamoDBAthenaSyncStackProps extends NestedStackProps {
  readonly config: StackConfig;
  readonly bucket: s3.IBucket;
  readonly crawlerRoleName: string;
  readonly athenaDb: string;
  readonly athenaOutputLocation: string;
  readonly tableMappings: TableMapping[];
}

export class DynamoDBAthenaSyncStack extends NestedStack {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: DynamoDBAthenaSyncStackProps) {
    super(scope, id);

    // Deploy Glue job script
    new s3deploy.BucketDeployment(this, 'dynamodb-sync-job-script', {
      destinationBucket: props.bucket,
      sources: [s3deploy.Source.asset(ProjectStructure.jobAsset)],
      destinationKeyPrefix: 'dynamodb-sync-job-asset/',
    });

    // Create Glue job for DynamoDB data transformation
    const job = new glue.CfnJob(this, 'dynamodb-sync-job', {
      name: generateStackResourceName(props.config, 'dynamodb-sync-job'),
      description: `DynamoDB data sync to Athena`,
      command: {
        name: 'glueetl',
        pythonVersion: '3',
        scriptLocation: props.bucket.s3UrlForObject('dynamodb-sync-job-asset/dynamodb-sync-job.py'),
      },
      role: this.getJobRole(props).roleArn,
      defaultArguments: {
        '--bucketName': props.bucket.bucketName,
        '--databaseName': props.athenaDb,
      },
      glueVersion: '5.0',
      workerType: 'G.1X',
      numberOfWorkers: 2,
      maxRetries: 0,
      timeout: 90,
      executionProperty: { maxConcurrentRuns: props.tableMappings.length },
    });

    // Create Step Functions state machine for orchestration
    this.stateMachine = this.createStateMachine(props, job);
  }

  private getJobRole(props: DynamoDBAthenaSyncStackProps): iam.Role {
    const roleName = generateStackResourceName(props.config, 'dynamodb-sync-job-role');
    const jobRole = new iam.Role(this, roleName, {
      roleName,
      assumedBy: new ServicePrincipal('glue.amazonaws.com'),
    });

    // Add AWS Glue service role policy
    jobRole.addManagedPolicy({
      managedPolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole',
    });

    // Add S3 permissions
    jobRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:*'],
        resources: [props.bucket.bucketArn, props.bucket.arnForObjects('*')],
      }),
    );

    return jobRole;
  }

  private createStateMachine(props: DynamoDBAthenaSyncStackProps, job: glue.CfnJob): sfn.StateMachine {
    // Create parallel branches for each table mapping
    const parallel = new sfn.Parallel(this, 'ParallelTableSyncs');
    const succeed = new sfn.Succeed(this, 'DynamoDBSyncSucceeded');

    // Add a branch for each table mapping
    props.tableMappings.forEach((mapping, index) => {
      const dynamoDbTableArn = `arn:aws:dynamodb:${AWSRegion}:${AWSAccount}:table/${mapping.ddbTableName}`;

      // Start DynamoDB export
      const startExport = new tasks.CallAwsService(this, `StartDynamoDBExport-${mapping.ddbTableName}-${index}`, {
        service: 'dynamodb',
        action: 'exportTableToPointInTime',
        iamResources: [dynamoDbTableArn],
        parameters: {
          TableArn: dynamoDbTableArn,
          S3Bucket: props.bucket.bucketName,
          S3Prefix: `dynamodb-export/${mapping.ddbTableName}`,
          ExportFormat: 'DYNAMODB_JSON',
          ExportType: 'FULL_EXPORT',
        },
        resultPath: `$.${mapping.ddbTableName}.exportDetails`,
      });

      // Check export status
      const checkExportStatus = new tasks.CallAwsService(this, `CheckExportStatus-${mapping.ddbTableName}-${index}`, {
        service: 'dynamodb',
        action: 'describeExport',
        iamResources: [`${dynamoDbTableArn}/*`],
        parameters: {
          ExportArn: sfn.JsonPath.stringAt(`$.${mapping.ddbTableName}.exportDetails.ExportDescription.ExportArn`),
        },
        resultPath: `$.${mapping.ddbTableName}.exportStatus`,
      });

      // Wait 2 minutes before next check
      const waitForExport = new sfn.Wait(this, `WaitForExport-${mapping.ddbTableName}-${index}`, {
        time: sfn.WaitTime.duration(Duration.minutes(2)),
      });

      // Start Glue job
      const startGlueJob = new tasks.GlueStartJobRun(this, `StartGlueJob-${mapping.ddbTableName}-${index}`, {
        glueJobName: job.name as string,
        integrationPattern: sfn.IntegrationPattern.RUN_JOB,
        arguments: sfn.TaskInput.fromObject({
          '--exportManifest': sfn.JsonPath.stringAt(
            `$.${mapping.ddbTableName}.exportStatus.ExportDescription.ExportManifest`,
          ),
          '--bucketName': props.bucket.bucketName,
          '--tableName': mapping.athenaTableName,
          '--databaseName': props.athenaDb,
        }),
      });

      // Define state machine flow for this table
      const isExportComplete = new sfn.Choice(this, `IsExportComplete-${mapping.ddbTableName}-${index}`)
        .when(
          sfn.Condition.stringEquals(
            `$.${mapping.ddbTableName}.exportStatus.ExportDescription.ExportStatus`,
            'COMPLETED',
          ),
          startGlueJob,
        )
        .when(
          sfn.Condition.stringEquals(`$.${mapping.ddbTableName}.exportStatus.ExportDescription.ExportStatus`, 'FAILED'),
          new sfn.Fail(this, `ExportFailed-${mapping.ddbTableName}-${index}`),
        )
        .otherwise(waitForExport);

      // Connect the states for this table
      startExport.next(checkExportStatus);
      checkExportStatus.next(isExportComplete);
      waitForExport.next(checkExportStatus);

      // Add this table's flow as a branch in the parallel state
      parallel.branch(startExport);
    });

    parallel.next(succeed);

    // Create the main state machine that runs all parallel branches
    const sm = new sfn.StateMachine(this, 'dynamodb-sync-state-machine', {
      stateMachineName: props.config.generateName('dynamodb-sync-state-machine'),
      definition: parallel,
    });

    // Add S3 permissions for all table exports
    sm.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [props.bucket.bucketArn, props.bucket.arnForObjects('*')],
      }),
    );

    return sm;
  }
}
