import { Construct } from 'constructs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Aws, Duration } from 'aws-cdk-lib';

/**
 * Properties for sending a message to an SQS queue
 */
export interface SqsSendMessageDynamicTargetProps extends sfn.TaskStateBaseProps {
  /**
   * Dynamic SQS queue input
   */
  readonly queueUrl: sfn.TaskInput;

  /**
   * The text message to send to the queue.
   */
  readonly messageBody: sfn.TaskInput;

  /**
   * The length of time, for which to delay a message.
   * Messages that you send to the queue remain invisible to consumers for the duration
   * of the delay period. The maximum allowed delay is 15 minutes.
   *
   * @default - delay set on the queue. If a delay is not set on the queue,
   *   messages are sent immediately (0 seconds).
   */
  readonly delay?: Duration;

  /**
   * The token used for deduplication of sent messages.
   * Any messages sent with the same deduplication ID are accepted successfully,
   * but aren't delivered during the 5-minute deduplication interval.
   *
   * @default - None
   */
  readonly messageDeduplicationId?: string;

  /**
   * The tag that specifies that a message belongs to a specific message group.
   *
   * Messages that belong to the same message group are processed in a FIFO manner.
   * Messages in different message groups might be processed out of order.
   *
   * @default - None
   */
  readonly messageGroupId?: string;
}

/**
 * A StepFunctions Task to send messages to SQS queue (with dynamic queue url target from parameter)
 */
export class SqsSendMessageDynamicTarget extends sfn.TaskStateBase {
  protected readonly taskMetrics?: sfn.TaskMetricsConfig;
  protected readonly taskPolicies?: iam.PolicyStatement[];
  private readonly integrationPattern: sfn.IntegrationPattern;

  constructor(scope: Construct, id: string, private readonly props: SqsSendMessageDynamicTargetProps) {
    super(scope, id, props);
    this.integrationPattern = props.integrationPattern ?? sfn.IntegrationPattern.REQUEST_RESPONSE;
    if (props.integrationPattern === sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN) {
      if (!sfn.FieldUtils.containsTaskToken(props.messageBody)) {
        throw new Error('Task Token is required in `messageBody` Use JsonPath.taskToken to set the token.');
      }
    }
  }

  /**
   * Provides the SQS SendMessage service integration task configuration
   */
  /**
   * @internal
   */
  protected _renderTask(): any {
    return {
      Resource: integrationResourceArn('sqs', 'sendMessage', this.integrationPattern),
      Parameters: sfn.FieldUtils.renderObject({
        QueueUrl: this.props.queueUrl.value,
        MessageBody: this.props.messageBody.value,
        DelaySeconds: this.props.delay?.toSeconds(),
        MessageDeduplicationId: this.props.messageDeduplicationId,
        MessageGroupId: this.props.messageGroupId,
      }),
    };
  }
}

const resourceArnSuffix: Record<sfn.IntegrationPattern, string> = {
  [sfn.IntegrationPattern.REQUEST_RESPONSE]: '',
  [sfn.IntegrationPattern.RUN_JOB]: '.sync',
  [sfn.IntegrationPattern.WAIT_FOR_TASK_TOKEN]: '.waitForTaskToken',
};

function integrationResourceArn(service: string, api: string, integrationPattern?: sfn.IntegrationPattern): string {
  if (!service || !api) {
    throw new Error("Both 'service' and 'api' must be provided to build the resource ARN.");
  }
  return (
    `arn:${Aws.PARTITION}:states:::${service}:${api}` +
    (integrationPattern ? resourceArnSuffix[integrationPattern] : '')
  );
}
