import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '../common/logger';
import { Athena } from '../integrations/athena';
import { DynamoDB } from '../integrations/dynamodb';
import { GoogleDocs } from '../integrations/google-docs';
import { ApplicationStepC, GradingRuleC, querySalesforce } from '../integrations/salesforce';
import { Sqs } from '../integrations/sqs';
import { GradingBatch } from '../model/grading-batch';
import { GradingRule } from '../model/grading-rule';
import {
  DefaultGradingMode,
  GradingMode,
  GradingTask,
  GradingTaskDocument,
  QuestionAndAnswer,
} from '../model/grading-task';

const log = Logger.create('dryRunGradingHandler');

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  log.plain('EVENT', event);

  const request: DryRunRequestPayload = JSON.parse(event.body ?? '{}');

  // Fetch grading mode
  const asQueryResults = await querySalesforce<ApplicationStepC>(`
    SELECT XO_Grading_Mode__c
    FROM ApplicationStep__c
    WHERE Id = '${request.applicationStepId}'
    LIMIT 1
`);
  const gradingMode: GradingMode = asQueryResults.records[0]?.XO_Grading_Mode__c ?? DefaultGradingMode;
  log.info(`Fetched grading mode for the Application Step: ${gradingMode}`);

  // Fetch grading rules
  const rules: GradingRule[] = [];
  // Query grading rules for application step
  const queryResults = await querySalesforce<GradingRuleC>(
    `
    SELECT Id,
            Name,
            Active__c,
            Rule__c,
            Pass_Examples__c,
            Fail_Examples__c,
            Application_Step__c,
            SM_Key_Name_Pattern__c,
            AI_Grading_Mode__c,
            Score__c,
            Content_Type__c,
            Model__c
    FROM Grading_Rule__c
    WHERE Application_Step__c = '${request.applicationStepId}'
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
      aiGradingMode: gradingRule.AI_Grading_Mode__c,
      score: gradingRule.Score__c,
      contentType: gradingRule.Content_Type__c,
      model: gradingRule.Model__c,
    });
  });
  log.plain('RULES_FETCHED', rules);

  if (rules.length == 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: `No grading rules found for the application step ${request.applicationStepId}`,
      }),
    };
  }

  // Prepare GradingBatch
  const batch = GradingBatch.newDocument({
    data: request,
    tasksCompleted: 0,
    tasksCount: 0, // We will update it later
  });

  const logContext = log.context({
    applicationStepId: request.applicationStepId,
    batchId: batch.id,
  });

  // Now let's define the tasks
  // We need to query ASRs from Athena
  log.info(`Fetching ASRs from Athena from ${request.startDate} till ${request.endDate}`, logContext);
  const athenaQuery = `
SELECT 
    asr."id" as applicationStepResultId, 
    asr."external_submission_test_id__c" as externalSubmissionTestId, 
    asr."submission_time__c" as submissionTime, 
    asr."score__c" as score,
    asr."grader__c" as grader,
    smr."surveymonkeyapp__question_name__c" as smQuestionName,
    smr."surveymonkeyapp__response_id__c" as smResponseId,
    smr."surveymonkeyapp__question_id__c" as smQuestionId,
    smr."surveymonkeyapp__response_value__c" as smResponseValue, 
    smr."surveymonkeyapp__survey_id__c" as smSurveyId,
    app."name" as applicationName
FROM "application_step_result__c" asr
JOIN "survey_monkey_app__response__c" smr 
    ON smr."application_step_result__c" = asr."id"
JOIN "opportunity" app 
    ON app."id" = asr."applicationid__c"
WHERE "application_step_id__c" = '${request.applicationStepId}'
AND from_iso8601_timestamp("submission_time__c") 
    BETWEEN from_iso8601_date('${request.startDate}') AND from_iso8601_date('${request.endDate}')
ORDER BY asr."submission_time__c" ASC, smr."createddate" ASC; 
  `.trim();
  log.plain(`ATHENA_QUERY`, athenaQuery);

  const result = await Athena.query<AthenaQueryResult>(athenaQuery);
  log.info(`Fetched ${result.length} rows from Athena`, logContext);

  // Prepare tasks - group by asr id and identify a proper SM response
  const tasks: GradingTaskDocument[] = [];
  const feedback: string[] = [];

  const tasksRawData = groupByAsr(result);
  tasksRawData.forEach((taskRawData) => {
    let submissionLink = '';
    const submissions: QuestionAndAnswer[] = [];

    // If ASR.External_Submission_Test_Id__c is not null → surveyId = ASR.External_Submission_Test_Id__c
    // Else → surveyId = oldest SurveyMonkeyApp__Survey_ID__c (based on CreatedDate)
    // from Survey_Monkey_App__Response__c for which Application_Step_Result__c = ASR.Id
    let surveyId = taskRawData.externalSubmissionTestId;
    if (surveyId?.length == 0) {
      // Responses are ordered by CreatedDate ASC, so the first one applicable will be the oldest
      surveyId = taskRawData.smResponses[0]?.smSurveyId;
    }

    if (surveyId?.length == 0) {
      feedback.push(`ASR ${taskRawData.applicationStepResultId}: Cannot detect SM Survey Id`);
      return;
    }

    if (gradingMode === 'SM Response') {
      // We want to get all responses for the survey id
      const forSurveyId = taskRawData.smResponses.filter((it) => it.smSurveyId === surveyId);

      // Now we want to make sure we only use one response in case there were many (this can be possible)
      // Since entries are ordered by date asc, we can simply get the response id of the last one to get the last submission
      const responseId = forSurveyId.length > 0 ? forSurveyId[forSurveyId.length - 1].smResponseId : '';

      // Filter only answers for that specific response id
      const forResponseId = forSurveyId.filter((it) => it.smResponseId === responseId);

      // Sort by question id asc to maintain natural order of questions
      forResponseId.sort((a, b) => parseInt(a.smQuestionId) - parseInt(b.smQuestionId));

      // Now we can create submissions
      forResponseId.forEach((smResponse) => {
        // Grouping by question name will merge multi-select questions
        const forSameQuestion = submissions.find((it) => it.question === smResponse.smQuestionName);
        if (forSameQuestion != null) {
          forSameQuestion.answer += `; ${smResponse.smResponseValue}`;
        } else {
          submissions.push({
            question: smResponse.smQuestionName,
            answer: smResponse.smResponseValue,
          });
        }
      });

      if (submissions.length == 0) {
        feedback.push(`ASR ${taskRawData.applicationStepResultId}: Cannot find any SM responses`);
        return;
      }
    } else {
      // Now we want to get the newest candidate's submission (in case if there are several)
      // It should be the last one for the survey id
      const forSurveyId = taskRawData.smResponses.filter(
        (it) => it.smSurveyId === surveyId && GoogleDocs.canBeGoogleDocument(it.smResponseValue),
      );
      submissionLink = forSurveyId[forSurveyId.length - 1]?.smResponseValue;

      if (submissionLink?.length == 0) {
        feedback.push(`ASR ${taskRawData.applicationStepResultId}: Submission link is empty`);
        return;
      }
    }

    // We can create a task now
    tasks.push(
      GradingTask.newDocument({
        applicationStepResultId: taskRawData.applicationStepResultId,
        applicationStepId: request.applicationStepId,
        status: 'Pending',
        gradingBatchId: batch.id,
        gradingMode: gradingMode,
        data: {
          applicationName: taskRawData.applicationName,
          grader: taskRawData.grader,
          score: taskRawData.score,
          submissionTime: taskRawData.submissionTime,
        },
        submissionLink: submissionLink?.length > 0 ? submissionLink : undefined,
        submission: submissions?.length > 0 ? submissions : undefined,
        rules,
      }),
    );
  });

  log.info(`Prepared ${tasks.length} grading tasks`, logContext);
  tasks.forEach((it) =>
    log.info(`Created a new grading task from dry run`, {
      ...logContext,
      taskId: it.id,
    }),
  );

  if (tasks.length === 0) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: `Did not find enough tasks for application step ${request.applicationStepId}`,
        feedback,
      }),
    };
  }

  // Update batch tasks count
  batch.tasksCount = tasks.length;

  // Insert all data
  await DynamoDB.putDocuments([batch, ...tasks], 10);

  // Send tasks to the SQS to trigger the grading
  await Sqs.bulkSendMessages(
    tasks.map((it) => ({
      type: 'grade-submission',
      taskId: it.id,
    })),
  );

  return {
    statusCode: 201,
    body: JSON.stringify({
      success: true,
      message: `Created ${tasks.length} grading tasks`,
      gradingBatchId: batch.id,
      feedback,
    }),
  };
}

function groupByAsr(records: AthenaQueryResult[]): RawTaskData[] {
  const result: RawTaskData[] = [];
  records.forEach((record) => {
    let grouped = result.find((it) => it.applicationStepResultId === record.applicationStepResultId);
    if (grouped == null) {
      grouped = {
        applicationStepResultId: record.applicationStepResultId,
        externalSubmissionTestId: record.externalSubmissionTestId,
        submissionTime: record.submissionTime,
        applicationName: record.applicationName,
        grader: record.grader,
        score: record.score,
        smResponses: [],
      };
      result.push(grouped);
    }
    grouped.smResponses.push({
      smQuestionName: record.smQuestionName,
      smResponseValue: record.smResponseValue,
      smResponseId: record.smResponseId,
      smSurveyId: record.smSurveyId,
      smQuestionId: record.smQuestionId,
    });
  });
  return result;
}

interface DryRunRequestPayload {
  applicationStepId: string;
  startDate: string;
  endDate: string;
  recipientEmail: string;
  notes: string;
}

interface AthenaQueryResult {
  applicationStepResultId: string;
  submissionTime: string;
  externalSubmissionTestId: string;
  smQuestionName: string;
  smResponseValue: string;
  smResponseId: string;
  smQuestionId: string;
  smSurveyId: string;
  score: string;
  grader: string;
  applicationName: string;
}

interface RawTaskData {
  applicationStepResultId: string;
  submissionTime: string;
  externalSubmissionTestId: string;
  score: string;
  grader: string;
  applicationName: string;
  smResponses: {
    smQuestionName: string;
    smResponseValue: string;
    smResponseId: string;
    smQuestionId: string;
    smSurveyId: string;
  }[];
}
