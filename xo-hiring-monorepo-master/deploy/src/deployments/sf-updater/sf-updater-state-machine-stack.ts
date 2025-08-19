import * as fs from 'fs';
import { Duration, NestedStack, NestedStackProps } from 'aws-cdk-lib';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as appflow from 'aws-cdk-lib/aws-appflow';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { generateStackResourceName } from '../../config/environments';
import { AppFlowConfig, FieldConfig, FlowConfig } from './sf-updater-config';
import { WaitTime } from 'aws-cdk-lib/aws-stepfunctions';

interface SfUpdaterStateMachineStackProps extends NestedStackProps {
  readonly flowName: string;
  readonly connectorProfileName: string;
  readonly flowConfig: FlowConfig;
  readonly stackConfig: StackConfig;
  readonly inputBucket: s3.Bucket;
  readonly cleanupFunc: lambda.Function;
  readonly splitFunc: lambda.Function;
}

const getInputPrefixWithoutLeadingSlash = (flowName: string) => `input_${flowName}`;

const getErrorsPrefixWithoutLeadingSlash = (flowName: string) => `errors_${flowName}`;

export class SfUpdaterStateMachineStack extends NestedStack {
  constructor(scope: Construct, id: string, props: SfUpdaterStateMachineStackProps) {
    if (!/^[a-zA-Z0-9_-]+$/.test(props.flowName)) {
      // because we will build a regexp from it later, and need to avoid special characters.
      throw new Error('Flow names should only contain letters, digits, underscore and hyphen.');
    }
    super(scope, id, props);

    // AppFlow
    const appflowConfig = props.flowConfig.appflowConfig;
    this.validateFlowConfig(appflowConfig);
    this.appFlow = this.createAppFlow(
      props.stackConfig,
      props.flowName,
      props.connectorProfileName,
      appflowConfig,
      props.inputBucket,
    );

    // state machine
    this.stateMachine = this.createStateMachine(props, this.appFlow);
    this.stateMachine.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonAthenaFullAccess'));

    // schedule
    if (props.flowConfig.cronExpression) {
      this.setupCron(props.stackConfig, this.stateMachine, props.flowConfig.cronExpression);
    }

    // error notifications
    if (props.flowConfig.failureSNSArn) {
      this.setupNotifications(
        props.stackConfig,
        this.stateMachine,
        sns.Topic.fromTopicArn(this, 'failure-topic', props.flowConfig.failureSNSArn),
      );
    }
  }

  stateMachine: sfn.StateMachine;
  appFlow: appflow.CfnFlow;

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

  private setupCron(config: StackConfig, stateMachine: sfn.StateMachine, expression: string): events.Rule {
    const ruleName = generateStackResourceName(config, 'weekly');
    return new events.Rule(this, ruleName, {
      ruleName,
      schedule: events.Schedule.expression(`cron(${expression})`),
      targets: [new targets.SfnStateMachine(stateMachine)],
    });
  }

  createAppFlow(
    config: StackConfig,
    flowName: string,
    connectorProfileName: string,
    appflowConfig: AppFlowConfig,
    inputBucket: s3.Bucket,
  ): appflow.CfnFlow {
    return new appflow.CfnFlow(this, `flow_${flowName}`, {
      flowName: generateStackResourceName(config, flowName),
      triggerConfig: appflowConfig.scheduleExpression
        ? {
            triggerType: 'Scheduled',
            triggerProperties: {
              scheduleExpression: appflowConfig.scheduleExpression,
            },
          }
        : {
            triggerType: 'OnDemand',
          },
      sourceFlowConfig: {
        connectorType: 'S3',
        sourceConnectorProperties: {
          s3: {
            // do not change anything here, upgrade will fail with "Do not update the object for the flow." error
            bucketName: inputBucket.bucketName,
            // this prefix should have leading slash
            bucketPrefix: `${getInputPrefixWithoutLeadingSlash(flowName)}/`,
            s3InputFormatConfig: {
              s3InputFileType: 'CSV',
            },
          },
        },
      },
      destinationFlowConfigList: [
        {
          connectorType: 'Salesforce',
          connectorProfileName: connectorProfileName,
          destinationConnectorProperties: {
            salesforce: {
              object: appflowConfig.objectType,
              writeOperationType: appflowConfig.writeOperationType,
              idFieldNames: this.getIdFieldNames(appflowConfig),
              errorHandlingConfig: {
                bucketName: inputBucket.bucketName,
                // this prefix should have no leading slash
                bucketPrefix: getErrorsPrefixWithoutLeadingSlash(flowName),
                failOnFirstError: appflowConfig.failOnFirstError === undefined ? true : appflowConfig.failOnFirstError,
              },
            },
          },
        },
      ],
      tasks: this.getTasks(appflowConfig),
      description: `Generated from xo-hiring-monorepo with CDKv2`,
    });
  }

  getIdFieldNames(flowConfig: AppFlowConfig): string[] | undefined {
    if (flowConfig.writeOperationType === 'UPSERT') {
      return [flowConfig.externalIdFieldName];
    } else if (flowConfig.writeOperationType === 'INSERT') {
      return undefined;
    }
    return ['Id'];
  }

  validateFlowConfig(flowConfig: AppFlowConfig) {
    if (flowConfig.writeOperationType !== 'DELETE') {
      if (flowConfig.fieldConfigs.findIndex((c) => c.name.toLowerCase() === 'id') >= 0) {
        throw new Error(
          'Id mapping should not be present in field configs. It will be added automatically for UPDATE and DELETE operations.',
        );
      }
    }

    if (flowConfig.writeOperationType === 'UPSERT') {
      if (
        flowConfig.fieldConfigs.findIndex(
          (c) => c.name.toLowerCase() === flowConfig.externalIdFieldName.toLowerCase(),
        ) < 0
      ) {
        throw new Error("UPSERT operation should map at least it's externalIdFieldName");
      }
    }
  }

  getFieldConfigs(flowConfig: AppFlowConfig): FieldConfig[] {
    const result: FieldConfig[] = [];

    if (flowConfig.writeOperationType === 'DELETE' || flowConfig.writeOperationType === 'UPDATE') {
      // automatic Id config
      result.push({ name: 'Id', sourceDataType: 'string', destinationDataType: 'id' });
    }

    if (flowConfig.writeOperationType !== 'DELETE') {
      result.push(...flowConfig.fieldConfigs);
    }

    return result;
  }

  getTasks(flowConfig: AppFlowConfig): appflow.CfnFlow.TaskProperty[] {
    const fieldConfigs = this.getFieldConfigs(flowConfig);
    const res: appflow.CfnFlow.TaskProperty[] = [
      {
        taskType: 'Filter',
        taskProperties: [],
        connectorOperator: {
          s3: 'PROJECTION',
        },
        sourceFields: fieldConfigs.map((f) => f.name),
      },
    ];
    for (const fieldConfig of fieldConfigs) {
      res.push({
        sourceFields: [fieldConfig.name],
        taskType: 'Map',
        destinationField: fieldConfig.name,
        connectorOperator: {
          salesforce: 'NO_OP',
        },
        taskProperties: [
          { key: 'SOURCE_DATA_TYPE', value: fieldConfig.sourceDataType },
          { key: 'DESTINATION_DATA_TYPE', value: fieldConfig.destinationDataType },
        ],
      });
    }
    return res;
  }

  createStateMachine(props: SfUpdaterStateMachineStackProps, appflow: appflow.CfnFlow): sfn.StateMachine {
    const inputPrefix = getInputPrefixWithoutLeadingSlash(props.flowName);

    const cleanBucket = new tasks.LambdaInvoke(this, 'Clean bucket', {
      lambdaFunction: props.cleanupFunc,
      payload: sfn.TaskInput.fromObject({
        bucketName: props.inputBucket.bucketName,
        keyPatterns: [`^${inputPrefix}\\/`],
      }),
      payloadResponseOnly: true,
    });

    // currently Athena is the only supported input type
    const startAthenaQueryExecution = new tasks.AthenaStartQueryExecution(this, 'Start an Athena query execution', {
      queryString: fs.readFileSync(props.flowConfig.inputConfig.querySourceFile, { encoding: 'utf-8' }),
      workGroup: 'primary',
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      queryExecutionContext: {
        databaseName: props.flowConfig.inputConfig.databaseName,
      },
      resultConfiguration: {
        outputLocation: {
          bucketName: props.inputBucket.bucketName,
          objectKey: inputPrefix,
        },
      },
    });

    const deleteMetadataFile = new tasks.LambdaInvoke(this, 'Delete metadata file', {
      lambdaFunction: props.cleanupFunc,
      payload: sfn.TaskInput.fromObject({
        bucketName: props.inputBucket.bucketName,
        keyPatterns: [`^${inputPrefix}\\/.+\\.csv\\.metadata$`],
      }),
      payloadResponseOnly: true,
    });

    const waitState = new sfn.Wait(this, 'Wait State', {
      time: WaitTime.duration(Duration.seconds(10)),
    });

    const splitLargeFile = new tasks.LambdaInvoke(this, 'Split large CSV file', {
      lambdaFunction: props.splitFunc,
      payload: sfn.TaskInput.fromObject({
        bucketName: props.inputBucket.bucketName,
        keyPatterns: [`^${inputPrefix}\\/.+\\.csv$`],
      }),
      payloadResponseOnly: true,
    });

    // call APPFLOW
    const callAppflow = new tasks.CallAwsService(this, 'Call Appflow', {
      service: 'appflow',
      action: 'startFlow',
      parameters: {
        FlowName: appflow.flowName,
      },
      iamResources: ['*'],
    });

    const wait30SecondsState = new sfn.Wait(this, 'Wait 30s State', {
      time: WaitTime.duration(Duration.seconds(30)),
    });

    const getExecutionStatus = new tasks.CallAwsService(this, 'Get flow last execution status', {
      service: 'appflow',
      action: 'describeFlow',
      parameters: {
        FlowName: appflow.flowName,
      },
      iamResources: ['*'],
      outputPath: '$.LastRunExecutionDetails',
    });

    const succeedState = new sfn.Succeed(this, 'Succeed!');
    const failState = new sfn.Fail(this, 'Failed', {
      cause: 'AppFlow has failed',
    });

    const checkExecutionStatus = new sfn.Choice(this, 'Check flow last execution status')
      .when(sfn.Condition.stringEquals('$.MostRecentExecutionStatus', 'InProgress'), wait30SecondsState)
      .when(sfn.Condition.stringEquals('$.MostRecentExecutionStatus', 'Successful'), succeedState)
      .otherwise(failState);

    // create the relations
    const definition = cleanBucket.next(startAthenaQueryExecution);
    startAthenaQueryExecution.next(deleteMetadataFile);
    deleteMetadataFile.next(waitState);
    waitState.next(splitLargeFile);
    splitLargeFile.next(callAppflow);
    callAppflow.next(wait30SecondsState);
    wait30SecondsState.next(getExecutionStatus);
    getExecutionStatus.next(checkExecutionStatus);
    return new sfn.StateMachine(this, 'stateMachine', {
      stateMachineName: generateStackResourceName(props.stackConfig, `sf_updater_${props.flowName}`),
      definition,
    });
  }
}
