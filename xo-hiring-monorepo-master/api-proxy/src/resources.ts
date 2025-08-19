import { isAxiosError } from 'axios';
import {
  AuthorizationError,
  authorizeApplicationOwner,
  authorizeApplicationStepResultOwner,
  authorizeCandidate,
  authorizeCandidateInformationOwner,
  checkEventCandidateMatch,
  checkEventPayloadFields,
  checkResponseCandidateMatch,
  denyAll,
} from './authorization';
import {
  ApplicationType,
  ApplyWithoutCandidateIdType,
  AsrType,
  CandidateType,
  CaseType,
  InfoType,
} from './data-contracts';
import { getRedirectConfig } from './http';
import { Candidates } from './internal-handlers/candidates';
import { Cases } from './internal-handlers/cases';
import { handleFAQHelpfulness } from './internal-handlers/faq-helpfulness';
import { recommendJobs, recommendJobsByJobRoleApplication } from './internal-handlers/job-recommendations';
import { handlePipelineMetadata } from './internal-handlers/pipeline-metadata';
import { Sourcing } from './internal-handlers/sourcing';
import { Testimonials } from './internal-handlers/testimonials';
import { VeriffEvents } from './internal-handlers/veriff-events';
import { logger } from './logger';
import {
  getStandardBfqConfig,
  getStandardBfqJobRoleConfig,
  standardBfqAnswersGet,
  standardBfqAnswersPost,
  standardBfqsGet,
} from './resources/bfq';
import { downloadResume, resumeExists, uploadResume } from './resources/s3-operations';
import { invokeApexrest } from './resources/salesforce-apexrest';
import { getProfilephoto } from './resources/salesforce-document-api';
import { invokeFlow } from './resources/salesforce-flow';
import { invokeInvocable } from './resources/salesforce-invocable';
import { query } from './resources/salesforce-query';
import { createSObject, deleteSObject, patchSObject } from './resources/salesforce-sobjects';
import { axiosResponse, HttpStatusCodes } from './responses';
import { DEFAULT_PHONE_NUMBER } from './services/cognito-service';
import { Resources } from './types';
import {
  AnyParameter,
  AppIdPathParameter,
  AsrIdPathParameter,
  IdPathParameter,
  parameterExists,
  ParameterType,
  requireParameter,
  SalesforceIdListParameter,
  SalesforceIdParameter,
  SalesforceObjectTypeParameter,
  SalesforceProductCodeParameter,
  SwitchParameter,
  UnsafeParameterForSoql,
} from './validation';
import axios from 'axios';
import { APIGatewayProxyEvent } from 'aws-lambda';

const resources: Resources = {
  '/apply': {
    post: async (e) => {
      // check that iVarT_CandidateId is not provided
      await checkEventPayloadFields(e, ApplyWithoutCandidateIdType);
      return invokeFlow(e, 'Apply');
    },
  },

  '/assessments': {
    get: (e) => {
      if (parameterExists(e, 'candidateId', ParameterType.QueryString)) {
        throw new AuthorizationError('CandidateId parameter is not allowed. Use candidate-specific endpoint instead.');
      }
      return invokeApexrest(e, 'get', 'Assessments', {
        categoryId: parameterExists(e, 'categoryId', ParameterType.QueryString)
          ? new SalesforceIdParameter(e, 'categoryId', ParameterType.QueryString)
          : undefined,
        domain: parameterExists(e, 'domain', ParameterType.QueryString)
          ? new AnyParameter(e, 'domain', ParameterType.QueryString)
          : undefined,
        pipelineIds: parameterExists(e, 'pipelineIds', ParameterType.QueryString)
          ? new SalesforceIdListParameter(e, 'pipelineIds', ParameterType.QueryString)
          : undefined,
        type: parameterExists(e, 'type', ParameterType.QueryString)
          ? new AnyParameter(e, 'type', ParameterType.QueryString)
          : undefined,
      });
    },
  },

  '/candidates/{id}': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: async (e) => {
        const candidateId = new IdPathParameter(e);

        // LAMBDA-83023: Remove personal information for anyone except the candidate
        let candidatePersonalFields = ',PersonEmail ,Phone';
        const { username } = e.requestContext.authorizer?.claims as { username?: string };
        if (username !== candidateId.toString()) {
          candidatePersonalFields = '';
        }

        const sel = `SELECT Id, 
              XO_Manage_ID__c,
              Name, 
              FirstName, 
              LastName,
              Website,
              PersonMailingCity, 
              Skype_Id__c, 
              Timezone__c,
              PersonMailingCountry, 
              Avatar__c, 
              Secondary_Email__c,
              Last_Password_Recovery__c,
              Last_Successful_Login__c,
              Password_Recovery_Count__c, 
              Successful_Login_Count__c, 
              PersonHasOptedOutOfEmail, 
              Last_Active_Application__c,
              Description, 
              Accepted_Privacy_Policy_At__c, 
              Accepted_Privacy_Policy_Date__c, 
              Current_Privacy_Policy_Date__c,
              Preferred_Application__c, 
              Is_Identity_Verified__c,
              Is_Verification_Required__c, 
              CCAT_Score__c,
              (SELECT Id FROM Job_Recommendations__r WHERE CreatedDate >= LAST_N_DAYS:7 AND Status__c != 'Outdated' LIMIT 1)
               ${candidatePersonalFields}
            FROM Account WHERE`;
        const idFilter = ` Id='${candidateId}'`;

        let xoManageIdFilter = '';
        if (parameterExists(e, 'xoManageId', ParameterType.QueryString)) {
          xoManageIdFilter = ` AND XO_Manage_ID__c='${new UnsafeParameterForSoql(
            e,
            'xoManageId',
            ParameterType.QueryString,
          )}'`;
        }
        const queryResponse = await query(e, `${sel}${idFilter}${xoManageIdFilter} LIMIT 1`);
        const records = queryResponse.data?.records;

        if (records != null && records.length > 0) {
          const record = records[0];
          // https://ws-lambda.atlassian.net/browse/LAMBDA-55667 - overriding HasResume__c if a resume is uploaded to S3
          record.HasResume__c = await resumeExists(e, process.env.S3_BUCKET_RESUMES as string);

          // LAMBDA-76579: Prepare the Job Recommendations for the candidate
          recommendJobs(record);
        }

        return queryResponse;
      },
    },

    patch: {
      eventAuthorizer: [authorizeCandidate, (e) => checkEventPayloadFields(e, CandidateType)],
      handler: (e) => invokeApexrest(e, 'patch', `SecureCrud/Account/${new IdPathParameter(e)}`),
    },
  },

  '/candidates/{id}/applications': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: async (e) => {
        const candidateId = new IdPathParameter(e);
        const { username } = e.requestContext.authorizer?.claims as { username?: string };
        const response = await invokeApexrest(e, 'get', `opportunity-candidate`, {
          Id: candidateId,
        });

        // LAMBDA-65767: Hide Marketplace Check from candidates
        // Due to auth limitations the current username can either match candidate id (meaning candidate requests this info),
        // Or this is a stuff / HM request
        if (username === candidateId.toString()) {
          // Remove Marketplace_Check_Result__c and Marketplace_Check_Comments__c
          response.data.records?.forEach((record: any) => {
            delete record.Marketplace_Check_Result__c;
            delete record.Marketplace_Check_Comments__c;
          });
        }

        return response;
      },
    },
  },

  '/candidates/{id}/applications/{appId}': {
    patch: {
      eventAuthorizer: [
        authorizeCandidate,
        authorizeApplicationOwner,
        (e) => checkEventPayloadFields(e, ApplicationType),
      ],
      handler: (e) => invokeApexrest(e, 'patch', `SecureCrud/Opportunity/${new AppIdPathParameter(e)}`),
    },
  },

  '/candidates/{id}/applications/{appId}/apply-email': {
    get: {
      eventAuthorizer: [
        authorizeCandidate,
        authorizeApplicationOwner,
        (e) => checkEventPayloadFields(e, ApplicationType),
      ],
      handler: (e) => Candidates.getApplyEmail(e),
    },
    post: {
      eventAuthorizer: [
        authorizeCandidate,
        authorizeApplicationOwner,
        (e) => checkEventPayloadFields(e, ApplicationType),
      ],
      handler: (e) => Candidates.generateApplyEmail(e),
    },
  },

  '/candidates/{id}/applications/{appId}/earnable-badges': {
    get: {
      eventAuthorizer: [authorizeCandidate, authorizeApplicationOwner],
      handler: (e) =>
        invokeApexrest(e, 'get', 'earnableBadges', {
          applicationId: new AppIdPathParameter(e),
        }),
    },
  },
  '/candidates/{id}/apply': {
    post: {
      eventAuthorizer: [
        authorizeCandidate,
        (e) => checkEventCandidateMatch(new IdPathParameter(e), e, '$.inputs..iVarT_CandidateId'),
      ],
      handler: (e) => invokeFlow(e, 'Apply'),
    },
  },
  '/candidates/{id}/assessment-results': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: async (e) => {
        const response = await query(
          e,
          `SELECT Candidate__c,
                  ApplicationId__c,
                  Application_Step_Id__c,
                  Badge_Earned__c,
                  Badge_Simulated__c,
                  Id,
                  Owner.Name,
                  Owner.Id,
                  Raw_Score__c,
                  Result_Time__c,
                  Score__c,
                  State__c,
                  Submission_URL__c,
                  Badge_Hidden__c,
                  GA_Client_Complete_ID__c,
                  Proctoring__c,
                  Submission_Time__c,
                  CreatedDate,
                  Name,
                  Reject_Threshold__c,
                  Retry_Threshold__c,
                  Threshold__c,
                  Scheduled_For_Time__c
           FROM Application_Step_Result__c
           WHERE ApplicationId__c IN (SELECT Id FROM Opportunity WHERE AccountId = '${new IdPathParameter(e)}')`,
        );

        if (e.requestContext.authorizer?.claims['elevatedAccess'] == null) {
          // We want to hide Submission_URL__c from non-admin users
          response.data?.records?.forEach((it: Record<string, string>) => delete it.Submission_URL__c);
        }

        return response;
      },
      responseAuthorizer: (e, r) =>
        checkResponseCandidateMatch(new IdPathParameter(e), r, '$.records..Candidate__c', true),
    },
  },
  '/candidates/{id}/assessment-results/{asrId}': {
    patch: {
      eventAuthorizer: [
        authorizeCandidate,
        authorizeApplicationStepResultOwner,
        (e) => checkEventPayloadFields(e, AsrType),
      ],
      handler: (e) => invokeApexrest(e, 'patch', `SecureCrud/Application_Step_Result__c/${new AsrIdPathParameter(e)}`),
    },
  },
  '/candidates/{id}/assessment-results/{asrId}/cancel': {
    post: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) =>
        invokeApexrest(e, 'post', 'dependent-applications', {
          asrId: new AsrIdPathParameter(e),
          candidateId: new IdPathParameter(e),
        }),
    },
  },
  '/candidates/{id}/assessment-results/{asrId}/complete': {
    post: {
      eventAuthorizer: [authorizeCandidate, authorizeApplicationStepResultOwner],
      handler: (e) => invokeApexrest(e, 'post', `assessment-result/${new AsrIdPathParameter(e)}/complete`),
    },
  },
  '/candidates/{id}/assessment-results/{asrId}/dependent-applications': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) =>
        invokeApexrest(e, 'get', 'dependent-applications', {
          asrId: new AsrIdPathParameter(e),
          candidateId: new IdPathParameter(e),
        }),
    },
  },
  '/candidates/{id}/assessment-results/{asrId}/get-url': {
    post: {
      eventAuthorizer: [authorizeCandidate, authorizeApplicationStepResultOwner],
      handler: (e) =>
        invokeApexrest(e, 'post', 'Application/getAssessmentUrl', {
          applicationStepResultId: new AsrIdPathParameter(e),
        }),
    },
  },
  '/candidates/{id}/assessment-results/{asrId}/responses': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) =>
        query(
          e,
          `SELECT Application_Step_Result__r.Candidate__c, Application_Step_Result__c,Id,Name,SurveyMonkeyApp__Question_Name__c,SurveyMonkeyApp__Response_Number_Value__c,SurveyMonkeyApp__Response_Text__c,SurveyMonkeyApp__Response_Value__c FROM SurveyMonkeyApp__Response__c WHERE Application_Step_Result__c = '${new AsrIdPathParameter(
            e,
          )}' ORDER BY CreatedDate, Name`,
        ),
      responseAuthorizer: (e, r) =>
        checkResponseCandidateMatch(new IdPathParameter(e), r, '$.records..Application_Step_Result__r.Candidate__c'),
    },
  },
  '/candidates/{id}/assessment-results/{asrId}/skip-interview': {
    patch: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => invokeApexrest(e, 'patch', `assessment-result/${new AsrIdPathParameter(e)}/skip-interview`),
    },
  },
  '/candidates/{id}/assessments': {
    get: {
      eventAuthorizer: [authorizeCandidate],
      handler: (e) =>
        invokeApexrest(e, 'get', 'Assessments', {
          candidateId: new IdPathParameter(e),
          categoryId: parameterExists(e, 'categoryId', ParameterType.QueryString)
            ? new SalesforceIdParameter(e, 'categoryId', ParameterType.QueryString)
            : undefined,
          domain: parameterExists(e, 'domain', ParameterType.QueryString)
            ? new AnyParameter(e, 'domain', ParameterType.QueryString)
            : undefined,
          pipelineIds: parameterExists(e, 'pipelineIds', ParameterType.QueryString)
            ? new SalesforceIdListParameter(e, 'pipelineIds', ParameterType.QueryString)
            : undefined,
          type: parameterExists(e, 'type', ParameterType.QueryString)
            ? new AnyParameter(e, 'type', ParameterType.QueryString)
            : undefined,
        }),
    },
  },
  '/candidates/{id}/cases': {
    post: {
      eventAuthorizer: [
        authorizeCandidate,
        (e) => checkEventCandidateMatch(new IdPathParameter(e), e, '$.AccountId'),
        (e) => checkEventPayloadFields(e, CaseType),
      ],
      handler: Cases.createCase,
    },
  },
  '/candidates/{id}/contacts': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => query(e, `SELECT Id FROM Contact WHERE AccountId ='${new IdPathParameter(e)}'`),
    },
  },
  '/candidates/{id}/download-resume': {
    get: (e) => downloadResume(e, process.env.S3_BUCKET_RESUMES as string),
  },
  '/candidates/{id}/earned-badges': {
    get: {
      eventAuthorizer: denyAll,
      handler: (e) =>
        invokeApexrest(e, 'get', `candidates/${new IdPathParameter(e)}/earned-badges`, {
          jobId: parameterExists(e, 'jobId', ParameterType.QueryString)
            ? new AnyParameter(e, 'jobId', ParameterType.QueryString)
            : undefined,
        }),
    },
  },
  '/candidates/{id}/executive-summary/{pipelineId}': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: Candidates.generateExecutiveSummary,
    },
  },
  '/candidates/{id}/identity-proof': {
    post: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => invokeApexrest(e, 'post', `candidate/${new IdPathParameter(e)}/identity-proof`),
    },
  },
  '/candidates/{id}/identity-proof/latest': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => invokeApexrest(e, 'get', `candidate/${new IdPathParameter(e)}/identity-proof/latest`),
    },
  },
  '/candidates/{id}/info': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) =>
        query(
          e,
          `SELECT Associated_with__c, Id, Name, ExternalId__c, RecordType.Name, What__c, Institution__c, Start_Date_Accurate__c, Start_Date__c, Start_Month_Accurate__c, End_Date__c, End_Month_Accurate__c, End_Date_Accurate__c, Ongoing__c, Description__c,CreatedDate, LastModifiedDate, Employment_Type__c, Degree__c, Grade__c, Patent_State__c,URL__c, Candidate__c FROM Candidate_Information__c WHERE Candidate__c ='${new IdPathParameter(
            e,
          )}'`,
        ),
    },
    post: {
      eventAuthorizer: [
        authorizeCandidate,
        (e) => checkEventCandidateMatch(new IdPathParameter(e), e, '$.Candidate__c'),
        (e) => checkEventPayloadFields(e, InfoType),
      ],
      handler: (e) => createSObject(e, 'Candidate_Information__c'),
    },
  },
  '/candidates/{id}/info/{infoid}': {
    delete: {
      eventAuthorizer: [authorizeCandidate, authorizeCandidateInformationOwner],
      handler: (e) =>
        deleteSObject(e, 'Candidate_Information__c', new SalesforceIdParameter(e, 'infoid', ParameterType.Path)),
    },
    patch: {
      eventAuthorizer: [
        authorizeCandidate,
        authorizeCandidateInformationOwner,
        (e) => checkEventPayloadFields(e, InfoType),
      ],
      handler: (e) =>
        patchSObject(e, 'Candidate_Information__c', new SalesforceIdParameter(e, 'infoid', ParameterType.Path)),
    },
  },
  '/candidates/{id}/location': {
    patch: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => invokeApexrest(e, 'patch', `candidates/${new IdPathParameter(e)}/location`),
    },
  },
  '/candidates/{id}/next-step': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => invokeApexrest(e, 'get', `candidates/${new IdPathParameter(e)}/next-step`),
    },
  },
  '/candidates/{id}/pipelines/{pipelineId}/earnable-badges': {
    get: {
      eventAuthorizer: [authorizeCandidate],
      handler: (e) =>
        invokeApexrest(e, 'get', 'earnableBadges', {
          candidateId: new IdPathParameter(e),
          pipelineId: new SalesforceIdParameter(e, 'pipelineId', ParameterType.Path),
        }),
    },
  },
  '/candidates/{id}/privacy-policy-accept': {
    post: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) =>
        invokeInvocable(e, 'PrivacyPolicyService', {
          inputs: [{ candidateIds: `${new IdPathParameter(e)}` }],
        }),
    },
  },
  '/candidates/{id}/recommended-jobs': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) =>
        invokeApexrest(e, 'get', 'candidates/recommended-jobs', {
          candidateId: new IdPathParameter(e),
        }),
    },
  },
  '/candidates/{id}/recommended-jobs/interactions': {
    post: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) =>
        invokeApexrest(e, 'post', 'JobRecommendation/Interaction', {
          candidateId: new IdPathParameter(e),
        }),
    },
  },
  '/candidates/{id}/resume': {
    post: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => uploadResume(e, process.env.S3_BUCKET_RESUMES as string),
    },
  },
  '/candidates/{id}/spotlight/{pipelineId}': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: Candidates.getSpotlight,
    },
  },
  '/candidates/{id}/standard-bfq-answers': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => standardBfqAnswersGet(e, getStandardBfqConfig()),
    },
    post: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => standardBfqAnswersPost(e, getStandardBfqConfig()),
    },
  },
  '/candidates/{id}/standard-bfq-answers/job-role': {
    get: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => standardBfqAnswersGet(e, getStandardBfqJobRoleConfig()),
    },
    post: {
      eventAuthorizer: authorizeCandidate,
      handler: (e) => {
        const response = standardBfqAnswersPost(e, getStandardBfqJobRoleConfig());

        recommendJobsByJobRoleApplication(new IdPathParameter(e).toString());

        return response;
      },
    },
  },
  '/check-email': {
    post: async (e) => {
      return Candidates.checkEmail(e);
    },
  },
  '/cmsupdate/faqhelpfulness': {
    post: (e) => {
      return handleFAQHelpfulness(e);
    },
  },
  '/cmsupdate/pipelineMetadata': {
    post: (e) => {
      return handlePipelineMetadata(e);
    },
  },
  '/email-settings': {
    get: (e) =>
      invokeApexrest(e, 'get', `email-settings`, {
        token: new AnyParameter(e, 'token', ParameterType.QueryString),
      }),
    post: (e) => invokeApexrest(e, 'post', `email-settings`),
  },
  '/googlejobs/getJobPostingSchema': {
    get: (e) =>
      invokeApexrest(e, 'get', `googlejobs/getJobPostingSchema`, {
        jobId: new SalesforceIdParameter(e, 'jobId', ParameterType.QueryString),
        jobIdType: new SwitchParameter(e, 'jobIdType', ParameterType.QueryString, [
          'Pipeline',
          'PipelineJobTitle',
          'JobBoardCell',
        ]),
      }),
  },
  '/googlejobs/topCellsInCity': {
    get: (e) =>
      invokeApexrest(e, 'get', `googlejobs/topCellsInCity`, {
        city: new AnyParameter(e, 'city', ParameterType.QueryString),
        country: new AnyParameter(e, 'country', ParameterType.QueryString),
        pipelines: parameterExists(e, 'pipelines', ParameterType.QueryString)
          ? new AnyParameter(e, 'pipelines', ParameterType.QueryString)
          : undefined,
      }),
  },
  '/googlejobs/topCities/{country}': {
    get: async (e) => {
      const country = new AnyParameter(e, 'country', ParameterType.Path);
      try {
        return await invokeApexrest(e, 'get', `googlejobs/topCities/${country}`);
      } catch (error) {
        if (isAxiosError(error) && [400, 404].includes(error.response?.status ?? 500)) {
          // API is expected to return 400 and 404 when we cannot find the provided country, or it is disabled/embargoed
          // Do not return anything in such case
          return axiosResponse(200, []);
        }
        throw error;
      }
    },
  },
  '/googlejobs/topCountries': {
    get: (e) => invokeApexrest(e, 'get', `googlejobs/topCountries`),
  },
  '/googlejobs/topTitles': {
    get: (e) =>
      invokeApexrest(e, 'get', `googlejobs/topTitles`, {
        pipelines: new SalesforceIdListParameter(e, 'pipelines', ParameterType.QueryString),
      }),
  },
  '/indeed-apply': {
    post: async (e) => {
      try {
        const response = await invokeApexrest(e, 'post', `new-indeed-application`);
        return axiosResponse(response.status, response.data, response.headers);
      } catch (error) {
        if (isAxiosError(error)) {
          logger.error(`Error during indeed-apply: (${error.response?.status}) ${error.message}`, {
            body: e.body,
          });
          // Proxy non-200 response from the SF to the caller
          return axiosResponse(
            error.response?.status ?? HttpStatusCodes.InternalServerError,
            error.response?.data,
            error.response?.headers,
          );
        } else {
          throw e;
        }
      }
    },
  },
  '/jobBoardCell/{id}': {
    get: (e) =>
      query(
        e,
        `Select Id, Pipeline_Job_Title__r.Is_Active__c, Pipeline_Job_Title__r.Job_Title__c, Pipeline_Job_Title__r.Job_Title_Landing_Page_URL__c, Pipeline_Job_Title__r.Apply_URL__c, Location__r.City_Name__c, Location__r.Country__c, Pipeline_Job_Title__r.Pipeline__r.Id, Pipeline_Job_Title__r.Pipeline__r.ProductCode, Pipeline_Job_Title__r.Id from Job_Board_Cell__c where Id='${new IdPathParameter(
          e,
        )}'`,
      ),
  },
  '/leads': {
    post: (e) => invokeApexrest(e, 'post', `leads`),
  },
  '/maintenance-metadata': {
    get: (e) =>
      query(e, `SELECT Active__c, Addresses__c, DeveloperName, MasterLabel, Message__c FROM Maintenance__mdt`),
  },
  '/picklist-values/{object}/{field}': {
    get: (e) =>
      invokeApexrest(
        e,
        'get',
        `picklistvalues/${new SalesforceObjectTypeParameter(
          e,
          'object',
          ParameterType.Path,
        )}/${new SalesforceObjectTypeParameter(e, 'field', ParameterType.Path)}`,
      ),
  },
  '/pipelines': {
    get: (e) => {
      const q = `SELECT Id, Name, Family, Sourcing_World_Map__c, Sourcing_World_Map__r.Name, Sourcing_World_Map__r.Domains__c, Brand__c, Brand__r.Id, Brand__r.Name, Brand__r.Logo_URL__c, ProductCode, Outbound_Prospecting__c, HTR_Assistance__c, Outbound_Content_Ready__c, OwnerId__c, Primary_Hiring_Manager__c, ManagerId__c, RemoteCamp_Manager__c, Hourly_Rate__c, Hours_per_Week__c, Monthly_Rate__c, Yearly_Rate__c, Type__c, Job_Type__c, DisplayURL, Landing_Page_URL__c, Apply_URL__c, Status__c,  Profile_Centric__c, Geographic_Restriction__c, Work_Country__c, Sourcing_Geographic_Restriction__c, (SELECT Id, Name, Status, Source_Pipeline__c, Source_Pipeline__r.Name, Source_Pipeline__r.ProductCode, Source_Pipeline__r.Hourly_Rate__c, Source_Pipeline__r.Hours_per_Week__c, Source_Pipeline__r.Monthly_Rate__c, Source_Pipeline__r.Yearly_Rate__c, Source_Pipeline__r.Type__c, Source_Pipeline__r.Job_Type__c, Source_Pipeline__r.Family, Source_Pipeline__r.Brand__r.Name, Source_Pipeline__r.DisplayURL, Source_Pipeline__r.Landing_Page_URL__c, Source_Pipeline__r.Apply_URL__c, Source_Pipeline__r.Profile_Centric__c FROM Campaigns__r WHERE Type='Retargeting' AND Source_Pipeline__r.Status__c = 'Active' ORDER BY Source_Pipeline__r.Family ASC, Source_Pipeline__r.Hourly_Rate__c ASC, Source_Pipeline__r.Name ASC), (SELECT Id, Name, Status, Pipeline__c, Pipeline__r.Name, Pipeline__r.ProductCode, Pipeline__r.Hourly_Rate__c, Pipeline__r.Hours_per_Week__c, Pipeline__r.Monthly_Rate__c, Pipeline__r.Yearly_Rate__c, Pipeline__r.Type__c, Pipeline__r.Job_Type__c, Pipeline__r.Family, Pipeline__r.Brand__r.Name, Pipeline__r.DisplayURL, Pipeline__r.Landing_Page_URL__c, Pipeline__r.Apply_URL__c, Pipeline__r.Profile_Centric__c FROM Retarget_to_Pipeline__r WHERE Type='Retargeting' AND Pipeline__r.Status__c = 'Active'  ORDER BY Pipeline__r.Family ASC, Pipeline__r.Hourly_Rate__c ASC, Pipeline__r.Name ASC), (SELECT Id, Name, Location__r.Id, Location__r.Name, Location__r.Country__c, Location__r.State_Name__c, Location__r.State_Code__c, Location__r.City_Name__c, Location__r.Name_in_Recruiter__c, Location__r.LI_Posting_Name__c FROM Work_Locations__r) FROM Product2 WHERE Id <> null `;

      let stakeholderIdFilter = '';
      if (e.queryStringParameters?.['stakeholderId']) {
        const stakeholderId = new SalesforceIdParameter(e, 'stakeholderId', ParameterType.QueryString);
        stakeholderIdFilter = ` AND (Primary_Hiring_Manager__c = '${stakeholderId}' OR ManagerId__c = '${stakeholderId}' OR OwnerId__c = '${stakeholderId}')`;
      }

      let productCodeFilter = '';
      if (e.queryStringParameters?.['product-code']) {
        productCodeFilter = ` AND ProductCode = '${new SalesforceProductCodeParameter(
          e,
          'product-code',
          ParameterType.QueryString,
        )}'`;
      }

      let statusFilter = '';
      if (e.queryStringParameters?.['status']) {
        statusFilter = ` AND Status__c = '${new UnsafeParameterForSoql(e, 'status', ParameterType.QueryString)}'`;
      }
      return query(e, `${q}${stakeholderIdFilter}${productCodeFilter}${statusFilter}`);
    },
  },
  '/pipelines/{id}': {
    get: async (e) => {
      const q = `SELECT Id, Name, Family, Sourcing_World_Map__c, Sourcing_World_Map__r.Name, Sourcing_World_Map__r.Domains__c, Brand__c, Brand__r.Id, Brand__r.Name, Brand__r.Logo_URL__c, ProductCode, Outbound_Prospecting__c, HTR_Assistance__c, Outbound_Content_Ready__c, OwnerId__c, Primary_Hiring_Manager__c, ManagerId__c, RemoteCamp_Manager__c, Hourly_Rate__c, Hours_per_Week__c, Monthly_Rate__c, Yearly_Rate__c, Type__c, Job_Type__c, DisplayURL, Landing_Page_URL__c, Apply_URL__c, Status__c,  Profile_Centric__c, XO_Manage_Team__c, XO_Manage_Manager__c, (SELECT Id, Name, Status, Source_Pipeline__c, Source_Pipeline__r.Name, Source_Pipeline__r.ProductCode, Source_Pipeline__r.Hourly_Rate__c, Source_Pipeline__r.Hours_per_Week__c, Source_Pipeline__r.Monthly_Rate__c, Source_Pipeline__r.Yearly_Rate__c, Source_Pipeline__r.Type__c, Source_Pipeline__r.Job_Type__c, Source_Pipeline__r.Family, Source_Pipeline__r.Brand__r.Name, Source_Pipeline__r.DisplayURL, Source_Pipeline__r.Landing_Page_URL__c, Source_Pipeline__r.Apply_URL__c, Source_Pipeline__r.Profile_Centric__c FROM Campaigns__r WHERE Type='Retargeting' AND Source_Pipeline__r.Status__c = 'Active' ORDER BY Source_Pipeline__r.Family ASC, Source_Pipeline__r.Hourly_Rate__c ASC, Source_Pipeline__r.Name ASC), (SELECT Id, Name, Status, Pipeline__c, Pipeline__r.Name, Pipeline__r.ProductCode, Pipeline__r.Hourly_Rate__c, Pipeline__r.Hours_per_Week__c, Pipeline__r.Monthly_Rate__c, Pipeline__r.Yearly_Rate__c, Pipeline__r.Type__c, Pipeline__r.Job_Type__c, Pipeline__r.Family, Pipeline__r.Brand__r.Name, Pipeline__r.DisplayURL, Pipeline__r.Landing_Page_URL__c, Pipeline__r.Apply_URL__c, Pipeline__r.Profile_Centric__c FROM Retarget_to_Pipeline__r WHERE Type='Retargeting' AND Pipeline__r.Status__c = 'Active'  ORDER BY Pipeline__r.Family ASC, Pipeline__r.Hourly_Rate__c ASC, Pipeline__r.Name ASC), (SELECT Id, Name, Location__r.Id, Location__r.Name, Location__r.Country__c, Location__r.State_Name__c, Location__r.State_Code__c, Location__r.City_Name__c, Location__r.Name_in_Recruiter__c, Location__r.LI_Posting_Name__c FROM Work_Locations__r), Sourcing_Geographic_Restriction__c, Work_Country__c, Geographic_Restriction__c FROM Product2 WHERE Id <> null `;

      const idOrCode = requireParameter(e, 'id', ParameterType.Path);

      const productFilter =
        idOrCode.length >= 15
          ? ` AND Id='${new IdPathParameter(e)}'`
          : ` AND ProductCode='${new SalesforceProductCodeParameter(e, 'id', ParameterType.Path)}'`;

      const response = await query(e, `${q}${productFilter} LIMIT 1`);

      // Check if the user has elevated access
      const hasElevatedAccess = e.requestContext?.authorizer?.claims['elevatedAccess'] === 'true';

      // If the user doesn't have elevated access, remove the restricted fields
      if (!hasElevatedAccess && response.data && response.data.records && response.data.records.length > 0) {
        delete response.data.records[0].XO_Manage_Manager__c;
        delete response.data.records[0].XO_Manage_Team__c;
      }

      return response;
    },
  },
  '/proctoredAssessment/{asrId}': {
    get: (e) =>
      invokeApexrest(e, 'get', `proctoredAssessment/${new AsrIdPathParameter(e)}`, undefined, getRedirectConfig()),
  },
  '/record-types/{object-name}': {
    get: (e) =>
      query(
        e,
        `SELECT Description, DeveloperName, Id, IsActive, IsPersonType, Name FROM RecordType WHERE SobjectType='${new SalesforceObjectTypeParameter(
          e,
          'object-name',
          ParameterType.Path,
        )}'`,
      ),
  },
  '/roles/{id}': {
    get: async (e) => {
      const jobTitleResponse = await query(
        e,
        `SELECT Id,
                Apply_URL__c,
                Is_Active__c,
                Job_Title__c,
                Landing_Page_URL__c,
                Pipeline__r.Id,
                Pipeline__r.ProductCode
         FROM Pipeline_Job_Title__c
         WHERE Id = '${new IdPathParameter(e)}' LIMIT 1`,
      );

      const titleData = jobTitleResponse.data?.records?.[0];
      if (titleData != null) {
        const titleVariation = await Sourcing.fetchJobAdTitleVariation(titleData.Id);
        if (titleVariation != null) {
          titleData.titleVariation = titleVariation;
        }
      }

      return jobTitleResponse;
    },
  },
  '/sourcing/generate-job-ads-variations': {
    post: {
      eventAuthorizer: denyAll,
      handler: Sourcing.triggerJobAdVariationGeneration,
    },
  },
  '/sourcing/job-ad-title-variation/{titleIds}': {
    get: {
      eventAuthorizer: denyAll,
      handler: Sourcing.getJobAdTitleVariations,
    },
  },
  '/sso/{provider}/userinfo': {
    get: async (e: APIGatewayProxyEvent) => {
      const provider = new AnyParameter(e, 'provider', ParameterType.Path).toString().toLowerCase();
      const authorizationHeader = e.headers?.['Authorization'] ?? e.headers?.['authorization'];

      if (!authorizationHeader) {
        logger.warn('Authorization header missing for userinfo request', {
          method: e.httpMethod,
          path: e.path,
          provider,
        });
        return axiosResponse(HttpStatusCodes.BadRequest, { message: 'Authorization header is required.' });
      }

      let userInfoUrl: string;
      switch (provider) {
        case 'google':
          userInfoUrl = 'https://openidconnect.googleapis.com/v1/userinfo';
          break;
        case 'linkedin':
          userInfoUrl = 'https://api.linkedin.com/v2/userinfo';
          break;
        default:
          logger.error(`Unknown SSO provider received: ${provider}`, { method: e.httpMethod, path: e.path, provider });
          return axiosResponse(404, { message: `Provider '${provider}' is unknown.` });
      }

      logger.info(`Forwarding request to ${provider} userinfo endpoint`, { url: userInfoUrl });
      const externalApiResponse = await axios.get(userInfoUrl, {
        headers: { Authorization: authorizationHeader },
      });
      logger.info(`Received response from ${provider} userinfo endpoint:`, {
        data: externalApiResponse.data,
        status: externalApiResponse.status,
      });
      const responseBody = externalApiResponse.data;

      // Add phone_number field if it doesn't exist and responseBody is an object
      if (responseBody && typeof responseBody === 'object' && !responseBody.phone_number) {
        if (!responseBody.phone_number) {
          responseBody.phone_number = DEFAULT_PHONE_NUMBER;
          logger.info(`Added default phone number to ${provider} response`);
        }
        // Also add email verified attribute
        responseBody.email_verified = 'true';
      }

      logger.info(`Modified response for provider '${provider}':`, { responseBody });
      return axiosResponse(externalApiResponse.status, responseBody, externalApiResponse.headers);
    },
  },
  '/standard-bfqs': {
    get: (e) => standardBfqsGet(e, getStandardBfqConfig()),
  },
  '/support-contact/{id}': {
    get: (e) =>
      query(
        e,
        `SELECT Id, Name, FullPhotoUrl, MediumPhotoUrl, Title FROM User WHERE Id='${new IdPathParameter(e)}' LIMIT 1`,
      ),
  },
  '/testimonials/allContinents': {
    get: Testimonials.allContinents,
  },
  '/testimonials/byContinent': {
    get: Testimonials.testimonialsByContinent,
  },
  '/testimonials/byCountry': {
    get: Testimonials.testimonialsByCountry,
  },
  '/testimonials/byCountryAndDomain': {
    get: Testimonials.testimonialsByCountryAndDomain,
  },
  '/testimonials/countryContinent': {
    get: Testimonials.countryContinent,
  },
  '/tracking': {
    // Using GET to allow integrating this endpoint via tracking pixel
    get: async (e) => {
      try {
        await invokeApexrest(e, 'post', `tracking/${new AnyParameter(e, 'id', ParameterType.QueryString)}`);
      } catch (err) {
        logger.error(`Tracking pixel integration error`, err as Error);
      }

      return axiosResponse(HttpStatusCodes.NoContent);
    },
  },
  '/ui-strings': {
    get: (e) => query(e, 'SELECT MasterLabel, DeveloperName, String__c FROM UI_String__mdt'),
  },
  '/user-image/{id}': {
    get: (e) => getProfilephoto(e, `${new IdPathParameter(e)}`),
  },
  '/verify-hash-id': {
    post: Candidates.verifyHashId,
  },
  '/webhook/veriff/decision': {
    post: VeriffEvents.handleDecision,
  },
  '/webhook/veriff/event': {
    post: VeriffEvents.handleEvent,
  },
  '/{secretKey}/delete-candidate-data': {
    post: Candidates.deleteCandidateData,
  },
};

export default resources;
