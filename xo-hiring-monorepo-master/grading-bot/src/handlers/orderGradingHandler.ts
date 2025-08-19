import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../common/logger';
import { DynamoDB } from '../integrations/dynamodb';
import { GradingRuleC, querySalesforce } from '../integrations/salesforce';
import { Sqs } from '../integrations/sqs';
import { GradingRule } from '../model/grading-rule';
import { DefaultGradingMode, GradingMode, GradingTask, QuestionAndAnswer } from '../model/grading-task';

const log = Logger.create('orderGradingHandler');

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  log.plain('EVENT', event);

  const request: OrderRequest = JSON.parse(event.body ?? '{}');
  const tasks: OrderRequestGradingTask[] = request?.payload?.tasks ?? [];
  if (tasks.length == 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: `No tasks provided as an input`,
      }),
    };
  }

  // Fetch grading rules if we don't have them provided
  const rules: GradingRule[] = request?.payload?.rules ?? [];
  if (rules.length == 0) {
    const uniqueApplicationStepIds = new Set<string>();
    tasks.forEach((it) => uniqueApplicationStepIds.add(it.applicationStepId));
    const asIds = [...uniqueApplicationStepIds].map((it) => `'${it}'`).join(', ');

    // Query grading rules for application steps
    const queryResults = await querySalesforce<GradingRuleC>(
      `
    SELECT Id,
            Name,
            Rule__c,
            Pass_Examples__c,
            Fail_Examples__c,
            Application_Step__c,
            SM_Key_Name_Pattern__c,
            Content_Type__c,
            Model__c
    FROM Grading_Rule__c
    WHERE Application_Step__c IN (${asIds})
    ORDER BY CreatedDate ASC
    `.trim(),
    );
    queryResults.records.forEach((gradingRule) => {
      rules.push({
        id: gradingRule.Id,
        applicationStepId: gradingRule.Application_Step__c,
        name: gradingRule.Name,
        rule: gradingRule.Rule__c,
        failExamples: gradingRule.Fail_Examples__c,
        passExamples: gradingRule.Pass_Examples__c,
        smKeyNamePattern: gradingRule.SM_Key_Name_Pattern__c,
        contentType: gradingRule.Content_Type__c,
        model: gradingRule.Model__c,
      });
    });
    log.info(`Fetched ${rules.length} rules from the Salesforce`);
    log.plain(JSON.stringify(rules, null, 2));
  }
  if (rules.length == 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: `No grading rules found for the tasks`,
      }),
    };
  }

  // Create tasks with applicable rules
  const taskDocuments = tasks.map((task) => {
    return GradingTask.newDocument({
      gradingMode: (task.gradingMode as GradingMode) ?? DefaultGradingMode,
      submission: task.submission,
      submissionLink: task.submissionLink,
      applicationStepResultId: task.applicationStepResultId,
      applicationStepId: task.applicationStepId,
      callbackUrl: request.callback_url,
      rules: rules.filter((it) => it.applicationStepId === task.applicationStepId),
      status: 'Pending',
      forceNoGradingDelay: task.forceNoGradingDelay,
    });
  });

  taskDocuments.forEach((it) =>
    log.info(
      `Created a new grading task`,
      log.context({
        ...it,
        taskId: it.id,
      }),
    ),
  );

  await DynamoDB.putDocuments(taskDocuments, 10);

  // Send tasks to the SQS
  await Sqs.bulkSendMessages(
    taskDocuments.map((it) => ({
      type: 'grade-submission',
      taskId: it.id,
    })),
  );

  return {
    statusCode: 201,
    body: JSON.stringify({
      success: true,
    }),
  };
}

interface OrderRequest {
  callback_url: string;
  order_id: string;
  payload: OrderRequestPayload;
}

interface OrderRequestPayload {
  tasks?: OrderRequestGradingTask[];
  rules?: GradingRule[];
}

export interface OrderRequestGradingTask {
  submissionLink: string;
  applicationStepResultId: string;
  applicationStepId: string;
  gradingMode: string;
  submission: QuestionAndAnswer[];
  forceNoGradingDelay?: boolean;
}
