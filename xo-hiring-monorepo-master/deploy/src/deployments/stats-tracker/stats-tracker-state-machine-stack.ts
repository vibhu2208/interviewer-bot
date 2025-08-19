import { NestedStack, NestedStackProps, Stack } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Duration } from 'aws-cdk-lib';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { IntegrationPattern, WaitTime } from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

// From: stats-tracker/common/common
// Do not reference files outside the project, if dependency requires packages everything will go wrong
export enum StateMachineStep {
  ProtectAgainstDuplicateRun = 'ProtectAgainstDuplicateRun',
  GetLastBackupJobStatus = 'GetLastBackupJobStatus',
  StartExportJob = 'StartExportJob',
  GetExportJobStatus = 'GetExportJobStatus',
}

interface StateMachineStackProps extends NestedStackProps {
  readonly stateMachineId: string;
  readonly stateMachineName: string;
  readonly ownBackUpExporterLambda: lambda.Function;
  readonly trackerRefresherLambda: lambda.Function;
  readonly kontentExporterLambda: lambda.Function;
  readonly indexCandidatesLambda: lambda.Function;
  readonly indexCandidateInfoLambda: lambda.Function;
  readonly glueJobName: string;
  readonly glueCrawlerName: string;
  readonly ddbSyncStateMachine: sfn.StateMachine;
}

export class StatsTrackerStateMachineStack extends NestedStack {
  constructor(scope: Construct, id: string, props: StateMachineStackProps) {
    super(scope, id, props);
    this.stateMachine = this.createStateMachine(props);
  }

  stateMachine: sfn.StateMachine;

  private createStateMachine(props: StateMachineStackProps): sfn.StateMachine {
    const succeed = new sfn.Succeed(this, 'Succeed');

    const protectAgainstDuplicateRun = new tasks.LambdaInvoke(this, StateMachineStep.ProtectAgainstDuplicateRun, {
      lambdaFunction: props.ownBackUpExporterLambda,
      payload: sfn.TaskInput.fromObject({
        step: StateMachineStep.ProtectAgainstDuplicateRun,
        'data.$': '$',
      }),
      payloadResponseOnly: true,
    });

    const getLastBackupJobStatus = new tasks.LambdaInvoke(this, StateMachineStep.GetLastBackupJobStatus, {
      lambdaFunction: props.ownBackUpExporterLambda,
      payload: sfn.TaskInput.fromObject({
        step: StateMachineStep.GetLastBackupJobStatus,
        'data.$': '$',
      }),
      payloadResponseOnly: true,
    });

    const waitForBackupJob = new sfn.Wait(this, 'Wait15Minutes', {
      time: WaitTime.duration(Duration.minutes(15)),
    });
    waitForBackupJob.next(getLastBackupJobStatus);

    const startExportJob = new tasks.LambdaInvoke(this, StateMachineStep.StartExportJob, {
      lambdaFunction: props.ownBackUpExporterLambda,
      payload: sfn.TaskInput.fromObject({
        step: StateMachineStep.StartExportJob,
        'data.$': '$',
      }),
      payloadResponseOnly: true,
    });

    const waitForExportJob = new sfn.Wait(this, 'Wait1Minute', {
      time: WaitTime.duration(Duration.minutes(1)),
    });

    const getExportJobStatus = new tasks.LambdaInvoke(this, StateMachineStep.GetExportJobStatus, {
      lambdaFunction: props.ownBackUpExporterLambda,
      payload: sfn.TaskInput.fromObject({
        step: StateMachineStep.GetExportJobStatus,
        'data.$': '$',
      }),
      payloadResponseOnly: true,
    });
    startExportJob.next(getExportJobStatus);
    waitForExportJob.next(getExportJobStatus);

    const startGlueJob = new tasks.GlueStartJobRun(this, 'GlueStartJobRun', {
      glueJobName: props.glueJobName,
      integrationPattern: IntegrationPattern.RUN_JOB,
    });

    const startGlueCrawler = new tasks.CallAwsService(this, 'GlueStartCrawler', {
      service: 'glue',
      action: 'startCrawler',
      iamResources: ['*'],
      parameters: {
        Name: props.glueCrawlerName,
      },
    });

    startGlueJob.next(startGlueCrawler);

    const indexCandidates = new tasks.LambdaInvoke(this, 'IndexCandidates', {
      lambdaFunction: props.indexCandidatesLambda,
      payload: sfn.TaskInput.fromObject({}),
      payloadResponseOnly: true,
    });
    const indexCandidatesRemaining = new tasks.LambdaInvoke(this, 'IndexCandidatesRemaining', {
      lambdaFunction: props.indexCandidatesLambda,
      payloadResponseOnly: true,
    });

    const indexCandidateInfo = new tasks.LambdaInvoke(this, 'IndexCandidateInfo', {
      lambdaFunction: props.indexCandidateInfoLambda,
      payload: sfn.TaskInput.fromObject({}),
      payloadResponseOnly: true,
    });
    const indexCandidateInfoRemaining = new tasks.LambdaInvoke(this, 'IndexCandidateInfoRemaining', {
      lambdaFunction: props.indexCandidateInfoLambda,
      payloadResponseOnly: true,
    });

    const refreshTracker = new tasks.LambdaInvoke(this, 'RefreshTracker', {
      lambdaFunction: props.trackerRefresherLambda,
    });

    const kontentExporter = new tasks.LambdaInvoke(this, 'KontentExporter', {
      lambdaFunction: props.kontentExporterLambda,
    });

    const getGlueCrawler = new tasks.CallAwsService(this, 'GlueGetCrawler', {
      service: 'glue',
      action: 'getCrawler',
      iamResources: ['*'],
      parameters: {
        Name: props.glueCrawlerName,
      },
      resultPath: '$.glueCrawler',
    });

    const waitForCrawler = new sfn.Wait(this, 'WaitForCrawler1Minute', {
      time: WaitTime.duration(Duration.minutes(1)),
    });
    startGlueCrawler.next(waitForCrawler);

    waitForCrawler.next(getGlueCrawler);

    const startDdbSyncStateMachine = new tasks.StepFunctionsStartExecution(this, 'StartDdbSyncStateMachine', {
      stateMachine: props.ddbSyncStateMachine,
      integrationPattern: IntegrationPattern.RUN_JOB,
    });

    const isGlueCrawlerComplete = new sfn.Choice(this, 'IsGlueCrawlerComplete')
      .when(
        sfn.Condition.stringEquals('$.glueCrawler.Crawler.State', 'READY'),
        new sfn.Parallel(this, 'ParallelExecution').branch(indexCandidates).branch(startDdbSyncStateMachine),
      )
      .otherwise(waitForCrawler);

    getGlueCrawler.next(isGlueCrawlerComplete);

    refreshTracker.next(kontentExporter);
    kontentExporter.next(succeed);

    const isExportJobComplete = new sfn.Choice(this, 'IsExportJobComplete')
      .when(sfn.Condition.booleanEquals('$.isExportJobComplete', true), startGlueJob)
      .otherwise(waitForExportJob);
    getExportJobStatus.next(isExportJobComplete);

    const backupJobTimeoutFail = new sfn.Fail(this, 'BackupJobTimeout', {
      cause: 'Backup job has taken too much time',
      comment: 'This run is terminated to not overlap with the next one',
    });

    const isBackupJobComplete = new sfn.Choice(this, 'IsBackupJobComplete')
      .when(sfn.Condition.booleanEquals('$.isBackupJobComplete', true), startExportJob)
      .otherwise(waitForBackupJob);

    const isBackupJobTimeout = new sfn.Choice(this, 'IsBackupJobTimeout')
      .when(sfn.Condition.booleanEquals('$.isBackupJobTimeout', true), backupJobTimeoutFail)
      .otherwise(isBackupJobComplete);

    getLastBackupJobStatus.next(isBackupJobTimeout);

    const isIndexCandidatesComplete = new sfn.Choice(this, 'IsIndexCandidatesComplete')
      .when(sfn.Condition.isPresent('$.nextToken'), indexCandidatesRemaining)
      .otherwise(indexCandidateInfo);
    indexCandidates.next(isIndexCandidatesComplete);
    indexCandidatesRemaining.next(isIndexCandidatesComplete);

    const isIndexCandidateInfoComplete = new sfn.Choice(this, 'IsIndexCandidateInfoComplete')
      .when(sfn.Condition.isPresent('$.nextToken'), indexCandidateInfoRemaining)
      .otherwise(refreshTracker);
    indexCandidateInfo.next(isIndexCandidateInfoComplete);
    indexCandidateInfoRemaining.next(isIndexCandidateInfoComplete);

    const definition = protectAgainstDuplicateRun.next(getLastBackupJobStatus);

    return new sfn.StateMachine(this, props.stateMachineId, {
      stateMachineName: props.stateMachineName,
      definition,
    });
  }
}
