import { SalesforceClient, defaultLogger, InterviewBotClient } from '@trilogy-group/xoh-integration';
import {
  AsrContextualIds,
  BadgeData,
  InterviewConversation,
  ProcessedAssessment,
} from '../models/summary-generator.model';

const log = defaultLogger({ serviceName: 'asr-data-service' });

let interviewBotClient: InterviewBotClient | undefined;

const initializeInterviewBotClient = () => {
  if (interviewBotClient) {
    return;
  }
  const interviewBotApiUrl = process.env.INTERVIEW_BOT_API_URL;
  if (!interviewBotApiUrl) {
    const errorMessage =
      'INTERVIEW_BOT_API_URL environment variable is not set. InterviewBotClient cannot be initialized.';
    log.error(errorMessage);
    throw new Error(errorMessage);
  }
  try {
    interviewBotClient = new InterviewBotClient(interviewBotApiUrl);
    log.info('InterviewBotClient initialized successfully.');
  } catch (error) {
    log.error('Failed to initialize InterviewBotClient:', error as Error);
    throw error;
  }
};

interface RawSalesforceAssessment {
  Name: string;
  Application_Step_Id__r?: {
    Display_Name__c: string;
    Badge_Description__c: string;
    Badge_Max_Proficiency__c: number;
    Provider__c: string;
    External_Submission_Assessment_ID__c: string;
  };
  Badge_Earned__r?: {
    Display_Name__c: string;
    Stars__c: number;
  };
  ApplicationId__c: string;
  External_Submission_Id__c?: string;
  Application_Stage__c?: string;
  Submission_Time__c?: string;
  SurveyMonkey_Responses__r?: {
    totalSize: number;
    done: boolean;
    records: Array<{
      Id: string;
      SurveyMonkeyApp__Question_Name__c: string;
      SurveyMonkeyApp__Response_Value__c: string;
    }> | null;
  };
}

export class AsrDataService {
  private readonly sfClient: SalesforceClient;

  constructor(sfClient: SalesforceClient) {
    this.sfClient = sfClient;
  }

  /**
   * Fetches key contextual IDs (PipelineID, CandidateID, ApplicationID)
   * from an Application Step Result (ASR).
   * @param asrId The ID of the Application Step Result.
   * @returns An object with IDs, or null if not found or ASR is incomplete.
   */
  public async getContextualIdsFromAsr(asrId: string): Promise<AsrContextualIds | null> {
    if (!asrId) {
      log.warn('Skipping getContextualIdsFromAsr fetch: asrId is missing.');
      return null;
    }
    try {
      const asrQueryResults = await this.sfClient.querySOQL<{
        Candidate__c: string;
        ApplicationId__c: string;
        ApplicationId__r: {
          Pipeline__r: {
            Id: string;
          };
        };
      }>(
        `SELECT 
            Candidate__c,
            ApplicationId__c, 
            ApplicationId__r.Pipeline__r.Id
         FROM Application_Step_Result__c 
         WHERE Id = '${asrId}' LIMIT 1`,
      );

      if (
        asrQueryResults.length > 0 &&
        asrQueryResults[0].Candidate__c &&
        asrQueryResults[0].ApplicationId__c &&
        asrQueryResults[0].ApplicationId__r?.Pipeline__r?.Id
      ) {
        const result = asrQueryResults[0];
        log.info(`Successfully fetched contextual IDs from ASRId: ${asrId}`);
        return {
          candidateId: result.Candidate__c,
          applicationId: result.ApplicationId__c,
          pipelineId: result.ApplicationId__r.Pipeline__r.Id,
        };
      } else {
        log.warn(`Could not find complete contextual IDs for ASRId: ${asrId}`);
        return null;
      }
    } catch (error) {
      log.error(`Error fetching contextual IDs from ASRId: ${asrId}`, error as Error);
      return null;
    }
  }

  /**
   * Fetches candidate assessments from Salesforce and maps them to ProcessedAssessment.
   */
  public async getCandidateAssessments(candidateId: string, applicationId: string): Promise<ProcessedAssessment[]> {
    if (!candidateId) {
      log.warn('Skipping getCandidateAssessments: candidateId is missing.');
      return [];
    }
    try {
      const rawAssessments = await this.sfClient.querySOQL<RawSalesforceAssessment>(`
        SELECT 
            Name,
            Application_Step_Id__r.Display_Name__c,
            Badge_Earned__r.Display_Name__c,
            Badge_Earned__r.Stars__c,
            ApplicationId__c,
            Application_Step_Id__r.Badge_Description__c,
            Application_Step_Id__r.Badge_Max_Proficiency__c,
            Application_Step_Id__r.Provider__c,
            Application_Step_Id__r.External_Submission_Assessment_ID__c,
            External_Submission_Id__c,
            Application_Stage__c,
            Submission_Time__c,
            (SELECT Id, SurveyMonkeyApp__Question_Name__c, SurveyMonkeyApp__Response_Value__c 
             FROM SurveyMonkey_Responses__r) 
        FROM Application_Step_Result__c 
        WHERE Candidate__c = '${candidateId}'
        AND (Score__c != NULL OR (Application_Stage__c = 'Interview' AND ApplicationId__c = '${applicationId}'))
      `);
      log.info(
        `Fetched ${rawAssessments.length} raw assessments (incl. survey attempts) for candidateId: ${candidateId}`,
      );

      const processedAssessments: ProcessedAssessment[] = rawAssessments.map((raw: RawSalesforceAssessment) => {
        const surveyResponses = raw.SurveyMonkey_Responses__r?.records
          ?.map((response) => ({
            question: response.SurveyMonkeyApp__Question_Name__c,
            response: response.SurveyMonkeyApp__Response_Value__c,
          }))
          .filter((sr) => sr.question && sr.response);

        return {
          assessmentName: raw.Name,
          stepDisplayName: raw.Application_Step_Id__r?.Display_Name__c || 'N/A',
          applicationId: raw.ApplicationId__c,
          badgeName: raw.Badge_Earned__r?.Display_Name__c,
          badgeStars: raw.Badge_Earned__r?.Stars__c,
          badgeDescription: raw.Application_Step_Id__r?.Badge_Description__c,
          badgeMaxProficiency: raw.Application_Step_Id__r?.Badge_Max_Proficiency__c,
          provider: raw.Application_Step_Id__r?.Provider__c,
          externalAssessmentId: raw.Application_Step_Id__r?.External_Submission_Assessment_ID__c,
          externalSubmissionId: raw.External_Submission_Id__c,
          surveyResponses: surveyResponses && surveyResponses.length > 0 ? surveyResponses : undefined,
          applicationStage: raw.Application_Stage__c,
          submissionTime: raw.Submission_Time__c ? new Date(raw.Submission_Time__c) : undefined,
        };
      });

      log.info(`Mapped to ${processedAssessments.length} processed assessments for candidateId: ${candidateId}`);
      return processedAssessments;
    } catch (error) {
      log.error(`Error fetching or processing assessments for candidateId ${candidateId}:`, error as Error);
      return [];
    }
  }

  /**
   * Extracts and transforms badge data from ProcessedAssessment records.
   */
  public getBadgesFromAssessments(assessments: ProcessedAssessment[]): BadgeData[] {
    if (!assessments || assessments.length === 0) {
      log.info('No assessments provided to getBadgesFromAssessments.');
      return [];
    }
    const badgeData = assessments
      .filter((assessment) => assessment.badgeName != null && assessment.badgeDescription != null)
      .map((assessment) => ({
        name: assessment.stepDisplayName,
        description: assessment.badgeDescription as string,
        level: assessment.badgeName as string,
        proficiency: assessment.badgeStars as number,
        maxProficiency: assessment.badgeMaxProficiency as number,
      }));
    log.info(`Processed ${badgeData.length} badges from ${assessments.length} assessments.`);
    return badgeData;
  }

  /**
   * Fetches AI-driven "matching interview" logs via the InterviewBotClient.
   * This method takes a list of processed assessments, sends them to the interview-bot service,
   * and returns a promise that resolves to an array of interview logs.
   * @param assessments - An array of processed assessment data.
   * @returns A promise that resolves to an array of `InterviewConversation` objects.
   */
  public async getAIInterviewConversations(assessments: ProcessedAssessment[]): Promise<InterviewConversation[]> {
    initializeInterviewBotClient();

    if (!interviewBotClient) {
      log.error('InterviewBotClient is not initialized. Cannot fetch matching interviews.');
      return [];
    }

    try {
      const xoAssessments = assessments.filter((it) => it.provider === 'XOAssessments');
      const sessionIds = xoAssessments.map((it) => it.externalSubmissionId).filter((it): it is string => it != null);

      if (sessionIds.length === 0) {
        log.info('No XOAssessments with session IDs found for candidate.');
        return [];
      }

      const clientResponse = await interviewBotClient.fetchInterviewConversations({
        sessionIds,
      });

      const result: InterviewConversation[] = clientResponse.map((logEntry) => {
        const assessment = xoAssessments.find((a) => a.externalSubmissionId === logEntry.sessionId);
        return {
          sourceName: assessment?.stepDisplayName ?? 'AI Matching Interview',
          conversation: logEntry.conversation.map((c) => ({
            role: c.role,
            content: c.content,
          })),
        };
      });

      log.info(`Successfully fetched ${result.length} AI matching interview logs via client.`);
      return result;
    } catch (e) {
      log.error('Error fetching AI matching interview logs via InterviewBotClient:', e as Error);
      return [];
    }
  }
}
