import { SalesforceClient } from '@trilogy-group/xoh-integration';
import { BmSubmissionGradingResult, SubmissionGradingQuestion } from '../handlers/grade-bm-submission';

interface QuestionAndAnswer {
  question: string;
  answer: string;
}

interface AsrSubmission {
  asrId: string;
  submission: QuestionAndAnswer[];
}

export async function getAsrSubmission(asrId: string, sf: SalesforceClient): Promise<AsrSubmission> {
  // Query Survey Monkey responses
  const smResponses = await sf.querySOQL<{
    Id: string;
    Application_Step_Result__c: string;
    SurveyMonkeyApp__Question_Name__c: string;
    SurveyMonkeyApp__Response_Value__c: string;
    SurveyMonkeyApp__Survey_ID__c: string;
    SurveyMonkeyApp__Response_ID__c: string;
  }>(`
      SELECT
              Id,
              Application_Step_Result__c,
              SurveyMonkeyApp__Question_Name__c,
              SurveyMonkeyApp__Response_Value__c,
              SurveyMonkeyApp__Survey_ID__c,
              SurveyMonkeyApp__Response_ID__c
      FROM SurveyMonkeyApp__Response__c
      WHERE Application_Step_Result__c = '${asrId}'
      ORDER BY CreatedDate ASC  
  `);

  // Query ASR details
  const asrDetails = await sf.querySOQL<{
    Id: string;
    External_Submission_Test_Id__c: string | null;
    Application_Step_Id__c: string;
    Application_Step_Id__r: {
      XO_Grading_Mode__c: string;
    };
  }>(`
      SELECT
              Id,
              External_Submission_Test_Id__c,
              Application_Step_Id__c,
              Application_Step_Id__r.XO_Grading_Mode__c
      FROM Application_Step_Result__c
      WHERE Id = '${asrId}'
  `);

  if (asrDetails.length === 0) {
    throw new Error('Cannot find ASR');
  }

  const asr = asrDetails[0];

  // Determine surveyId - either from External_Submission_Test_Id__c or from the oldest response
  let surveyId = asr.External_Submission_Test_Id__c;
  if (surveyId == null) {
    // Get the oldest response's survey ID
    const oldestResponse = smResponses.find((response) => response.Application_Step_Result__c === asr.Id);
    if (oldestResponse != null) {
      surveyId = oldestResponse.SurveyMonkeyApp__Survey_ID__c;
    }
  }

  if (surveyId == null) {
    throw new Error('Cannot determine surveyId for ASR');
  }

  const data: AsrSubmission = {
    asrId: asr.Id,
    submission: [],
  };

  if (asr.Application_Step_Id__r.XO_Grading_Mode__c === 'SM Response') {
    // Get all responses for the survey id
    const forSurveyId = smResponses.filter(
      (response) =>
        response.Application_Step_Result__c === asr.Id && response.SurveyMonkeyApp__Survey_ID__c === surveyId,
    );

    // Get the last response ID (most recent submission)
    const desiredResponseId =
      forSurveyId.length > 0 ? forSurveyId[forSurveyId.length - 1].SurveyMonkeyApp__Response_ID__c : null;

    // Combine answers for the same questions
    const forSameQuestion = new Map<string, string>();
    forSurveyId.forEach((response) => {
      if (desiredResponseId == null || response.SurveyMonkeyApp__Response_ID__c === desiredResponseId) {
        const existingAnswer = forSameQuestion.get(response.SurveyMonkeyApp__Question_Name__c);
        const newAnswer =
          existingAnswer != null
            ? `${existingAnswer}; ${response.SurveyMonkeyApp__Response_Value__c}`
            : response.SurveyMonkeyApp__Response_Value__c;
        forSameQuestion.set(response.SurveyMonkeyApp__Question_Name__c, newAnswer);
      }
    });

    // Add combined answers to task submission
    forSameQuestion.forEach((answer, question) => {
      data.submission.push({ question, answer });
    });

    if (data.submission.length === 0) {
      throw new Error('Cannot determine questions and answers for SM Response mode');
    }
  } else {
    throw new Error(`Unsupported grading mode: ${asr.Application_Step_Id__r.XO_Grading_Mode__c}`);
  }

  return data;
}

const Choices = [
  [
    '0-stars:Solution is not provided or does not use LLM.',
    '1-star:Email classification is attempted using LLM but accuracy is below 70%.',
    '2-stars:Solution is implemented using LLM and has average accuracy in range from 70% to 90%.',
    '3-stars:Solution is implemented using LLM and demonstrates high level of accuracy over 90%.',
  ],
  [
    '0-stars:Solution is not provided or does not use LLM.',
    '1-star:Orders are processed using LLM, but order status accuracy is below 50%.',
    '2-stars:Orders are processed using LLM, order status accuracy is above 50%. The solution uses product stock information, and keeps it updated.',
    '3-stars:Orders are processed using LLM with accuracy above 70%. The solution uses product stock information, and keeps it updated. Additionally, it generates relevant email order responses.',
  ],
  [
    '0-stars:Solution is not provided or does not use LLM.',
    '1-star:Solution uses LLM to generate relevant responses to inquiries but implemented with basic prompting, embedding all context information into the prompt.',
    '2-stars:Solution uses LLM to generate relevant responses to inquiries and filters the product database to reduce the context size.',
    '3-stars:Solution provides relevant responses to inquiries, and is using RAG and vector store techniques. It adapts to the tone of customer inquiry, provides extended answers with suggestions and recommendations.',
  ],
];

function commonSMObject(asrId: string, data: any): any {
  return {
    method: 'POST',
    url: `${SalesforceClient.ApiVersion}/sobjects/SurveyMonkeyApp__Response__c`,
    richInput: {
      Application_Step_Result__c: asrId,
      SurveyMonkeyApp__Survey_Name__c: 'FRQ - Beginner Mind Coding - Real Work - Grading - AutoGrader',
      SurveyMonkeyApp__Survey_ID__c: '1',
      SurveyMonkeyApp__Page_ID__c: '1',
      SurveyMonkeyApp__Collector_ID__c: '1',
      SurveyMonkeyApp__Question_ID__c: '1',
      SurveyMonkeyApp__Response_ID__c: '1',
      ...data,
    },
  };
}

export async function insertGradingResult(
  sf: SalesforceClient,
  asrId: string,
  result: BmSubmissionGradingResult,
): Promise<void> {
  const response = await sf.restApi().post(`/services/data/${SalesforceClient.ApiVersion}/composite/batch`, {
    batchRequests: [
      commonSMObject(asrId, {
        SurveyMonkeyApp__Question_Name__c: 'Email Classification',
        SurveyMonkeyApp__Choice_Name__c: Choices[0][result.first.score],
        SurveyMonkeyApp__Response_Value__c: Choices[0][result.first.score],
        SurveyMonkeyApp__Response_Number_Value__c: result.first.score,
        SurveyMonkeyApp__Choice_ID__c: `${result.first.score}`,
      }),
      commonSMObject(asrId, {
        SurveyMonkeyApp__Question_Name__c: 'Email Classification',
        SurveyMonkeyApp__Other_Text__c: result.first.reason,
        SurveyMonkeyApp__Response_Value__c: result.first.reason,
      }),
      commonSMObject(asrId, {
        SurveyMonkeyApp__Question_Name__c: 'Process Order Requests',
        SurveyMonkeyApp__Choice_Name__c: Choices[1][result.second.score],
        SurveyMonkeyApp__Response_Value__c: Choices[1][result.second.score],
        SurveyMonkeyApp__Response_Number_Value__c: result.second.score,
        SurveyMonkeyApp__Choice_ID__c: `${result.second.score}`,
      }),
      commonSMObject(asrId, {
        SurveyMonkeyApp__Question_Name__c: 'Process Order Requests',
        SurveyMonkeyApp__Other_Text__c: result.second.reason,
        SurveyMonkeyApp__Response_Value__c: result.second.reason,
      }),
      commonSMObject(asrId, {
        SurveyMonkeyApp__Question_Name__c: 'Handle Product Inquiries',
        SurveyMonkeyApp__Choice_Name__c: Choices[2][result.third.score],
        SurveyMonkeyApp__Response_Value__c: Choices[2][result.third.score],
        SurveyMonkeyApp__Response_Number_Value__c: result.third.score,
        SurveyMonkeyApp__Choice_ID__c: `${result.third.score}`,
      }),
      commonSMObject(asrId, {
        SurveyMonkeyApp__Question_Name__c: 'Handle Product Inquiries',
        SurveyMonkeyApp__Other_Text__c: result.third.reason,
        SurveyMonkeyApp__Response_Value__c: result.third.reason,
      }),
    ],
  });
  if (response.data.hasErrors) {
    throw new Error(`Failed to create SM records: \n${JSON.stringify(response.data, null, 2)}`);
  }

  await sf.updateObject('Application_Step_Result__c', asrId, {
    External_Test_Id__c: '518411787',
    Exernal_Result_Id__c: '1',
    Grading_Result_URL__c: 'https://beginner-mind-auto-grader.ai/not-available',
  });
}
