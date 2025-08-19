import { AwsConfig, Deployment, InfraInitConfig, RootStack, StackConfig } from '@trilogy-group/lambda-cdk-infra';
import { Duration } from 'aws-cdk-lib';
import * as cwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as actions from 'aws-cdk-lib/aws-ses-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as path from 'path';
import { ProjectName } from '../../config/environments';
import {
  SfExceptionsBackendStackName,
  SfExceptionsConfiguration,
  SfExceptionsLambdaProject,
  SfExceptionsProjectName,
} from './sf-exceptions-configuration';

@Deployment(SfExceptionsProjectName, SfExceptionsBackendStackName)
export class SfExceptionsStack extends RootStack {
  private readonly lambdaRole: iam.Role;
  private readonly lambdaCode: lambda.AssetCode;
  private readonly lambdaModules: lambda.LayerVersion;
  private readonly emailHandler: lambda.Function;

  constructor(config: StackConfig, private envConfig: SfExceptionsConfiguration) {
    super(patchStackConfig(config));

    // CloudWatch Log Group
    const logGroupName = `/salesforce/${config.environmentName}/exceptions`;
    const logGroup = new logs.LogGroup(this, this.config.generateLogicalId('log-group'), {
      logGroupName: logGroupName,
      retention: this.envConfig.logRetention,
      removalPolicy: this.envConfig.removalPolicy,
    });

    // CloudWatch Dashboard
    const dashboardName = this.config.generateName('dashboard');
    const dashboard = new cwatch.Dashboard(this, this.config.generateLogicalId('dashboard'), {
      dashboardName: dashboardName,
    });

    // Metrics
    const namespace = this.config.generateName('metrics');
    const logEventsFilter = logGroup.addMetricFilter('all-events-metric-filter', {
      metricNamespace: this.config.generateName('metrics'),
      metricName: 'All Events',
      metricValue: '1',
      filterPattern: logs.FilterPattern.exists('$.subject'),
      unit: cwatch.Unit.COUNT,
      dimensions: {
        Type: '$.type',
      },
    });

    const logEventsMetric = new cwatch.MathExpression({
      expression: `SELECT SUM("All Events") FROM "${namespace}"`,
      label: 'All Events',
      period: this.envConfig.metricsPeriod,
      color: '#ff0000',
    });

    // 'QueueLimitReached' | 'QueryLimitReached' | 'FlowException' | 'ApexException' | 'Uncategorized'
    const flowExceptionsMetric = logEventsFilter.metric({
      period: this.envConfig.metricsPeriod,
      unit: cwatch.Unit.COUNT,
      statistic: 'sum',
      label: 'Flow Exceptions',
      color: '#0080ff',
      dimensionsMap: {
        Type: 'FlowException',
      },
    });
    const apexExceptionsMetric = logEventsFilter.metric({
      period: this.envConfig.metricsPeriod,
      unit: cwatch.Unit.COUNT,
      statistic: 'sum',
      label: 'Apex Exceptions',
      color: '#00cc66',
      dimensionsMap: {
        Type: 'ApexException',
      },
    });
    const queueLimitMetric = logEventsFilter.metric({
      period: this.envConfig.metricsPeriod,
      unit: cwatch.Unit.COUNT,
      statistic: 'sum',
      label: 'Queue Size Limit',
      color: '#990000',
      dimensionsMap: {
        Type: 'QueueLimitReached',
      },
    });

    // Widget for the overall metric
    const logEventsWidget = new cwatch.GraphWidget({
      title: 'Exceptions per 10 minutes',
      left: [logEventsMetric, flowExceptionsMetric, apexExceptionsMetric, queueLimitMetric],
      width: 18,
      height: 8,
    });

    // Alarms
    const queueLimitAlarm = new cwatch.Alarm(this, this.config.generateLogicalId('queue-limit-alarm'), {
      alarmName: `SF Queue Limit (${config.environmentName})`,
      alarmDescription: 'The limit of 100 jobs in the flex queue is exceeded',
      metric: queueLimitMetric,
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cwatch.TreatMissingData.NOT_BREACHING,
      actionsEnabled: envConfig.alarmActionsEnabled,
    });

    const exceptionsCountAlarm = new cwatch.Alarm(this, this.config.generateLogicalId('exception-rate-alarm'), {
      alarmName: `SF Exceptions Rate (${config.environmentName})`,
      alarmDescription: 'The number of exception if exceeding the threshold',
      metric: logEventsMetric,
      threshold: 50,
      evaluationPeriods: 3,
      treatMissingData: cwatch.TreatMissingData.NOT_BREACHING,
      actionsEnabled: envConfig.alarmActionsEnabled,
    });

    if (envConfig.alarmActionsEnabled) {
      const snsTopic = sns.Topic.fromTopicArn(this, 'alarm-target', this.envConfig.alarmNotificationTarget);
      queueLimitAlarm.addAlarmAction(new cwactions.SnsAction(snsTopic));
      exceptionsCountAlarm.addAlarmAction(new cwactions.SnsAction(snsTopic));
    }

    // Alarms widget
    const alarmsWidget = new cwatch.AlarmStatusWidget({
      title: 'Alarms',
      alarms: [queueLimitAlarm, exceptionsCountAlarm],
      width: 6,
      height: 8,
    });

    // Display last exceptions
    const logsWidget = new cwatch.LogQueryWidget({
      title: 'Recent exceptions',
      logGroupNames: [logGroupName],
      queryString: `
        fields @timestamp, type, flowName, apexClassName, subject
          | sort @timestamp desc
          | limit 40`.trim(),
      width: 24,
      height: 12,
    });

    dashboard.addWidgets(logEventsWidget, alarmsWidget);
    dashboard.addWidgets(logsWidget);

    // Lambda
    this.lambdaCode = lambda.Code.fromAsset(path.join(SfExceptionsLambdaProject, 'dist/code'));
    this.lambdaModules = new lambda.LayerVersion(this, this.config.generateLogicalId('lambda-layer'), {
      code: lambda.Code.fromAsset(path.join(SfExceptionsLambdaProject, 'dist/layer')),
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
    logGroup.grantWrite(this.lambdaRole);

    this.emailHandler = new lambda.Function(this, this.config.generateLogicalId(`email-handler`), {
      functionName: this.config.generateName('email-handler'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: `index.handler`,
      code: this.lambdaCode,
      layers: [this.lambdaModules],
      logRetention: this.envConfig.logRetention,
      environment: {
        ENV: this.config.environmentName,
        LOG_GROUP_NAME: logGroupName,
      },
      timeout: Duration.minutes(5),
      role: this.lambdaRole,
      memorySize: 256,
    });

    // Route53 MX Record
    const hostedZone = route53.HostedZone.fromLookup(this, this.config.generateLogicalId('hosted-zone'), {
      domainName: 'crossover.com',
    });

    const recordName = this.envConfig.mxRecordName(this.config.environmentName);
    new route53.MxRecord(this, this.config.generateLogicalId('mx-record'), {
      zone: hostedZone,
      recordName: recordName,
      values: [
        {
          priority: 10,
          hostName: `inbound-smtp.${AwsConfig.getRegion()}.amazonaws.com`,
        },
      ],
    });

    // SNS
    const topic = new sns.Topic(this, this.config.generateLogicalId('email-topic'), {
      topicName: this.config.generateName('email-topic'),
    });

    this.emailHandler.addEventSource(new lambdaEventSources.SnsEventSource(topic));

    // SES
    const email = `log@${recordName}`;
    const globalRuleSet = ses.ReceiptRuleSet.fromReceiptRuleSetName(this, 'ses-main-rule-set', 'main');
    globalRuleSet.addRule('env-rule', {
      recipients: [email],
      actions: [
        new actions.Sns({
          topic: topic,
          encoding: actions.EmailEncoding.UTF8,
        }),
      ],
      enabled: true,
    });

    const consoleUrl = `https://${AwsConfig.getRegion()}.console.aws.amazon.com`;
    this.addOutput('ExceptionEmail', email);
    this.addOutput(
      'LogGroup',
      `${consoleUrl}/cloudwatch/home#logsV2:log-groups/log-group/${encodeURIComponent(logGroupName)}`,
    );
    this.addOutput(
      'Dashboard',
      `${consoleUrl}/cloudwatch/home#dashboards/dashboard/${encodeURIComponent(dashboardName)}`,
    );
  }
}

function patchStackConfig(config: StackConfig): StackConfig {
  const cfgInfra: InfraInitConfig = {
    ...config.infraConfig,
    projectName: `${ProjectName}-${SfExceptionsProjectName}`,
  };
  return new StackConfig(config.app, config.environmentName, cfgInfra, config.stackName, {
    ...config.props,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
  });
}
