import {
  AdminDisableUserCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SecretsManager, Llm } from '@trilogy-group/xoh-integration';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { AxiosResponse } from 'axios';
import { ApplyEmailDefaultPromptId, ApplyEmailTask } from '../ai-data/apply-email-task.model';
import { SpotlightDefaultPromptId, SpotlightTask } from '../ai-data/spotlight-task.model';
import { TaskStatus, TaskType } from '../ai-data/task.model';
import { invokeApexrest } from '../resources/salesforce-apexrest';
import { query } from '../resources/salesforce-query';
import { HttpStatusCodes, axiosResponse } from '../responses';
import { CognitoService } from '../services/cognito-service';
import { SSMConfig } from '../ssm-config';
import { ParameterType, SalesforceIdParameter } from '../validation';
import { Kontent } from './integrations/kontent';
import { OpenSearchClient } from './integrations/opensearch';
import { CoreMessage, generateText } from 'ai';
import axios from 'axios';
import { createDecipheriv } from 'node:crypto';
import { logger } from '../logger';

const TaskExpirationThreshold = 60 * 60 * 1000; // 1 hour
let ReCaptchaConfig: ReCaptchaConfig | null = null;

interface ReCaptchaConfig {
  siteKey: string;
  apiKey: string;
  riskScoreThreshold: string;
}

export interface SalesforceAccount {
  Id: string;
  FirstName: string;
  LastName: string;
  PersonEmail: string;
  Phone: string;
}

export class Candidates {
  public static async verifyHashId(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    try {
      const requestData = JSON.parse(event.body || '{}');
      const { id, hash } = requestData;

      if (id == null || hash == null) {
        logger.error('Missing required parameters', { id, hash });
        return axiosResponse(HttpStatusCodes.BadRequest, {
          error: 'Missing required parameters: id and hash',
        });
      }

      logger.appendKeys({
        candidateId: id,
      });

      // Decrypt the email using the provided id and hash
      const email = decryptHashId(id, hash);
      if (email == null) {
        logger.error('Failed to decrypt email', { id });
        return axiosResponse(HttpStatusCodes.BadRequest, {
          error: 'Invalid hash or id',
        });
      }

      logger.appendKeys({
        email,
      });

      logger.info('Processing verifyHashId request', { id, email });

      // Make parallel async calls to Cognito and Salesforce
      const userPoolId = process.env.USER_POOL_ID;
      if (!userPoolId) {
        throw new Error('USER_POOL_ID env variable is not defined');
      }

      const cognitoService = new CognitoService(userPoolId);

      const [cognitoUser, salesforceResult] = await Promise.all([
        cognitoService.getUser(id),
        query(
          event,
          `SELECT Id, FirstName, LastName, PersonEmail, Phone
           FROM Account
           WHERE Id = '${id}'`,
        ),
      ]);

      // Check if Salesforce user exists
      const salesforceUser: SalesforceAccount = salesforceResult.data?.records?.[0];
      if (!salesforceUser) {
        logger.error('Salesforce user not found');
        return axiosResponse(HttpStatusCodes.NotFound);
      }

      logger.info(`Found Salesforce user ${salesforceUser.Id} for ${email}`, {
        user: salesforceUser,
      });

      if (cognitoUser != null) {
        logger.info(`Cognito user ${cognitoUser.Username} already exists for ${email}`);
        return axiosResponse(HttpStatusCodes.Ok, {
          status: cognitoUser.UserStatus,
          user: cognitoUser,
          email,
        });
      }

      return axiosResponse(HttpStatusCodes.Ok, {
        status: 'MISSING',
        user: {
          id: salesforceUser.Id,
          firstName: salesforceUser.FirstName,
          lastName: salesforceUser.LastName,
          personEmail: salesforceUser.PersonEmail,
          phone: salesforceUser.Phone,
        },
        email,
      });
    } catch (error) {
      logger.error('Error in verifyHashId', { error: error as Error });
      return axiosResponse(HttpStatusCodes.InternalServerError, {
        error: 'Internal server error',
      });
    }
  }

  public static async getSpotlight(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    // Parse input parameters
    const candidateId = new SalesforceIdParameter(event, 'id', ParameterType.Path);
    const pipelineId = new SalesforceIdParameter(event, 'pipelineId', ParameterType.Path);

    // Get the Task record
    const task = await SpotlightTask.getSpotlightById(candidateId.toString(), pipelineId.toString());
    if (task != null) {
      const currentTime = new Date();
      const lastUpdateTime = task.lastUpdateTime ? new Date(task.lastUpdateTime) : null;
      if (
        lastUpdateTime &&
        currentTime.getTime() - lastUpdateTime.getTime() > TaskExpirationThreshold &&
        task.status !== TaskStatus.PROGRESS
      ) {
        try {
          logger.info('Task is expired, restarting:', { candidateId, pipelineId });
          await SpotlightTask.reStartTask(task);
          return axiosResponse(HttpStatusCodes.Ok, {
            status: TaskStatus.PROGRESS,
          });
        } catch (e) {
          logger.warn('Error restarting task:', e as Error); // It can be an issue with concurrent update, which is expected
        }
      }

      return axiosResponse(HttpStatusCodes.Ok, {
        status: task.status,
        summary: task.summary,
        error: task.error,
      });
    } else {
      // Create a new task document with status PROGRESS
      const newTask = SpotlightTask.newSpotlightTask({
        type: TaskType.SPOTLIGHT,
        status: TaskStatus.PROGRESS,
        candidateId: candidateId.toString(),
        pipelineId: pipelineId.toString(),
        promptId: SpotlightDefaultPromptId,
      });

      try {
        logger.info('Creating new task:', { candidateId, pipelineId });
        await SpotlightTask.saveTask(newTask);
      } catch (error) {
        logger.warn('Error creating new task:', error as Error);
      }

      return axiosResponse(HttpStatusCodes.Ok, {
        status: TaskStatus.PROGRESS,
      });
    }
  }

  /**
   * Get the apply email task for a candidate
   */
  public static async getApplyEmail(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    // Parse input parameters
    const candidateId = new SalesforceIdParameter(event, 'id', ParameterType.Path);
    const applicationId = new SalesforceIdParameter(event, 'appId', ParameterType.Path);

    // Get the Task record
    const task = await ApplyEmailTask.getById(candidateId.toString(), applicationId.toString());

    if (task != null) {
      return axiosResponse(HttpStatusCodes.Ok, {
        status: task.status,
        subject: task.subject,
        body: task.body,
        error: task.error,
      });
    }
    return axiosResponse(404);
  }

  /**
   * Generate apply email task for a candidate
   */
  public static async generateApplyEmail(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    // Parse input parameters
    const candidateId = new SalesforceIdParameter(event, 'id', ParameterType.Path);
    const applicationId = new SalesforceIdParameter(event, 'appId', ParameterType.Path);

    const task = await ApplyEmailTask.getById(candidateId.toString(), applicationId.toString());
    if (task) {
      // Task already exists
      return axiosResponse(409);
    }

    const newTask = ApplyEmailTask.create({
      type: TaskType.APPLY_EMAIL,
      status: TaskStatus.PROGRESS,
      candidateId: candidateId.toString(),
      applicationId: applicationId.toString(),
      promptId: ApplyEmailDefaultPromptId,
    });

    try {
      logger.info('Creating new task:', { candidateId, applicationId });
      await ApplyEmailTask.save(newTask);
    } catch (error) {
      logger.warn('Error creating new task:', error as Error);
    }

    return axiosResponse(HttpStatusCodes.Ok, {
      status: TaskStatus.PROGRESS,
    });
  }

  public static async generateExecutiveSummary(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    // Parse input parameters
    const candidateId = new SalesforceIdParameter(event, 'id', ParameterType.Path);
    const pipelineId = new SalesforceIdParameter(event, 'pipelineId', ParameterType.Path);

    // Get pipeline information
    const pipelineQueryResult = await query(
      event,
      `SELECT Name, Keywords__c, Type__c, ProductCode 
        FROM Product2 WHERE Id = '${pipelineId}'`,
    );
    const pipelineRecord = pipelineQueryResult.data?.records?.[0];
    if (!pipelineRecord) {
      logger.warn(`Requested pipeline ${pipelineId} is not found`);
      return axiosResponse(HttpStatusCodes.NoContent);
    }

    // Fetch SSM Config
    const config = await SSMConfig.getForEnvironment();

    // Get candidate resume
    const openSearchClient = OpenSearchClient.default(config);
    const candidateDocument = await openSearchClient.getCandidate(candidateId.toString());
    const candidateResumeFile = candidateDocument?.body?.['_source']?.resumeFile ?? '';
    const candidateResumeProfile = candidateDocument?.body?.['_source']?.resumeProfile ?? '';
    const candidateResume = `${candidateResumeFile}\n${candidateResumeProfile}`;

    if (candidateResume.length < 500) {
      logger.warn(`Combined resumeFile + resumeProfile length is just ${candidateResume.length}, skipping generation`);
      return axiosResponse(HttpStatusCodes.NoContent);
    }

    try {
      // Get LLM model
      const model = await Llm.getDefaultModel();

      // Prepare messages based on pipeline type
      const messages: CoreMessage[] = [];
      const isPrimePipeline = pipelineRecord.Type__c === 'Prime job';

      if (isPrimePipeline) {
        let keywordsTemplate = '';
        if (pipelineRecord.Keywords__c) {
          keywordsTemplate = config.chatgpt.candidateExecutiveSummary.executiveSummaryKeywords.replace(
            '{Keywords}',
            pipelineRecord.Keywords__c,
          );
        }

        const userPrompt = config.chatgpt.candidateExecutiveSummary.executiveSummaryPrompt
          .replace('{PipelineName}', pipelineRecord.Name)
          .replace('{KeywordsPrompt}', keywordsTemplate)
          .replace('{ResumeFile}', candidateResume);
        messages.push({ role: 'user', content: userPrompt });
      } else {
        const kontentClient = await Kontent.deliveryClient();
        const item = await kontentClient.item(`pipeline_${pipelineRecord.ProductCode}`).toPromise();
        const requirements = item.data.item.elements['requirements']?.value;

        messages.push({
          role: 'system',
          content: config.chatgpt.candidateExecutiveSummary.nonPrimeSystem,
        });

        const userPrompt = config.chatgpt.candidateExecutiveSummary.nonPrimeUser
          .replace('{PipelineName}', pipelineRecord.Name)
          .replace('{JobRequirements}', requirements)
          .replace('{ResumeFile}', candidateResume);
        messages.push({ role: 'user', content: userPrompt });
      }

      // Generate text using Vercel AI SDK
      const response = await generateText({
        messages,
        temperature: 0,
        model,
      });

      if (!response) {
        throw new Error('LLM responded with null output');
      }

      return axiosResponse(HttpStatusCodes.Ok, {
        summary: response.text,
      });
    } catch (error) {
      logger.error('Error generating executive summary:', error as Error);
      return axiosResponse(HttpStatusCodes.InternalServerError, {
        error: 'Failed to generate executive summary',
      });
    }
  }

  public static async deleteCandidateData(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    // Fetch SSM Config
    const config = await SSMConfig.getForEnvironment();

    // Check secret key
    const providedSecretKey = event.pathParameters?.['secretKey'];
    if (providedSecretKey !== config.candidateRemovalSecretKey) {
      return axiosResponse(HttpStatusCodes.BadRequest, {
        error: 'Secret key is not valid',
      });
    }

    // Extract candidate information
    const requestData: Partial<CandidateRemovalRequestBody> = JSON.parse(event.body ?? '{}');
    if (!requestData.candidateEmail || !requestData.candidateId) {
      return axiosResponse(HttpStatusCodes.BadRequest, {
        error: 'Missing required fields',
      });
    }

    // Perform a SOQL query to confirm that candidate email and id match
    const soqlQuery = `SELECT Id FROM Account WHERE Id = '${requestData.candidateId}' AND PersonEmail = '${requestData.candidateEmail}'`;
    const queryResult = await query(event, soqlQuery);
    const candidateRecord = queryResult.data?.records?.[0];

    if (!candidateRecord) {
      logger.info(
        `No matching candidate found for ID ${requestData.candidateId} and email ${requestData.candidateEmail}`,
      );
      return axiosResponse(HttpStatusCodes.BadRequest, {
        error: 'Candidate ID and email do not match',
      });
    }

    try {
      // Call SF endpoint to perform cleanup on SF side
      await invokeApexrest(event, 'post', `candidate/${requestData.candidateId}/remove-data`);

      // Update user data in Cognito
      await cleanupCandidateDataInCognito(requestData.candidateId);

      // Remove related files from S3
      await cleanupCandidateDataFromS3(requestData.candidateId);

      return axiosResponse(HttpStatusCodes.Ok, {
        message: 'Candidate data deleted successfully',
      });
    } catch (e) {
      logger.error(`Error while cleaning data for candidate ${requestData.candidateId}`, e as Error);
      return axiosResponse(HttpStatusCodes.InternalServerError, {
        error: 'Error while removing candidate data',
      });
    }
  }

  /**
   * Check if a user with the given email exists in the Cognito user pool
   */
  public static async checkEmail(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    try {
      // Parse request body
      const requestData = JSON.parse(event.body || '{}');
      const { email, token } = requestData;

      if (!email) {
        return axiosResponse(HttpStatusCodes.BadRequest, {
          error: 'Email is required',
          exists: false,
        });
      }

      if (!token) {
        return axiosResponse(HttpStatusCodes.BadRequest, {
          error: 'reCAPTCHA token is required',
          exists: false,
        });
      }

      if (ReCaptchaConfig == null) {
        const secretName = process.env.RECAPTCHA_SECRET_NAME;
        if (!secretName) {
          throw new Error('RECAPTCHA_SECRET_NAME environment variable is not defined');
        }
        const secret = await SecretsManager.fetchSecretJson<ReCaptchaConfig>(secretName);

        if (!secret) {
          throw new Error('Failed to get reCAPTCHA secret from Secrets Manager');
        } else {
          ReCaptchaConfig = secret;
        }
      }
      if (ReCaptchaConfig == null) {
        throw new Error('Failed to get reCAPTCHA secret from Secrets Manager');
      }

      // Call Google reCAPTCHA API to verify the token
      const verificationResponse = await axios.post(
        `https://recaptchaenterprise.googleapis.com/v1/projects/crossover-hire/assessments?key=${ReCaptchaConfig.apiKey}`,
        {
          event: {
            token: token,
            expectedAction: 'check-email',
            siteKey: ReCaptchaConfig.siteKey,
          },
        },
      );

      logger.info(`reCAPTCHA verification response:`, {
        response: verificationResponse.data,
      });

      // Check if verification was successful
      if (!verificationResponse.data.tokenProperties.valid) {
        return axiosResponse(HttpStatusCodes.BadRequest, {
          error: 'reCAPTCHA verification token invalid',
          exists: false,
        });
      }

      const targetThreshold = parseInt(ReCaptchaConfig.riskScoreThreshold);
      if (verificationResponse.data.riskAnalysis.score < targetThreshold) {
        logger.warn('reCAPTCHA verification risk score is below threshold', {
          score: verificationResponse.data.riskAnalysis.score,
        });

        return axiosResponse(HttpStatusCodes.BadRequest, {
          error: 'reCAPTCHA verification failed',
          exists: false,
        });
      }

      // Check if the user exists in Cognito
      const userPoolId = process.env.USER_POOL_ID;
      if (!userPoolId) {
        throw new Error('USER_POOL_ID env variable is not defined');
      }

      const cognito = new CognitoIdentityProviderClient();
      const response = await cognito.send(
        new ListUsersCommand({
          UserPoolId: userPoolId,
          Filter: `email = "${email}"`,
          Limit: 1,
        }),
      );

      const userExists = response.Users && response.Users.length > 0;

      logger.info(`Email check for ${email}: ${userExists ? 'found' : 'not found'}`);

      return axiosResponse(HttpStatusCodes.Ok, {
        exists: userExists,
      });
    } catch (error) {
      logger.error('Error checking email:', error as Error);
      return axiosResponse(HttpStatusCodes.InternalServerError, {
        error: 'Failed to check email',
        exists: false,
      });
    }
  }
}

async function cleanupCandidateDataInCognito(candidateId: string): Promise<void> {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) {
    throw new Error('USER_POOL_ID env variable is not defined');
  }

  try {
    const cognito = new CognitoIdentityProviderClient();
    const userData = await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: candidateId,
      }),
    );
    if (!userData) {
      logger.warn(`Cannot find user ${candidateId} in the cognito`);
      return;
    }

    logger.info(`Updating Cognito attributes for candidate ${candidateId}...`);
    const email = userData.UserAttributes?.find((it) => it.Name === 'email')?.Value ?? 'blank@example.com';
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: userPoolId,
        Username: candidateId,
        UserAttributes: [
          {
            Name: 'given_name',
            Value: 'DELETED',
          },
          {
            Name: 'family_name',
            Value: 'DELETED',
          },
          {
            Name: 'email',
            Value: `deleted_${email}`,
          },
          {
            Name: 'phone_number',
            Value: '+15555555555',
          },
          {
            Name: 'email_verified',
            Value: 'true',
          },
        ],
      }),
    );
    logger.info(`Disabling Cognito user for candidate ${candidateId}...`);
    await cognito.send(
      new AdminDisableUserCommand({
        UserPoolId: userPoolId,
        Username: candidateId,
      }),
    );
  } catch (e) {
    logger.info(`Cannot cleanup Cognito: ${e}`);
  }
}

async function cleanupCandidateDataFromS3(candidateId: string): Promise<void> {
  const s3 = new S3Client({
    region: process.env.AWS_REGION,
  });

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_BFQ,
        Key: `answers/${candidateId}`,
      }),
    );
    logger.info(`Removed BFQ answers for candidate ${candidateId}`);
  } catch (e) {
    logger.error(`Error while removing BFQ answers for candidate ${candidateId}`, e as Error);
  }

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_RESUMES,
        Key: candidateId,
      }),
    );
    logger.info(`Removed resume for candidate ${candidateId}`);
  } catch (e) {
    logger.error(`Error while removing resume for candidate ${candidateId}`, e as Error);
  }

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET_XO_HIRE_UPLOADS,
        Key: `${candidateId}-avatar`,
      }),
    );
    logger.info(`Removed avatar for candidate ${candidateId}`);
  } catch (e) {
    logger.info(`Error while removing avatar for candidate ${candidateId}`, e as Error);
  }
}

/**
 * Decrypt email using AES decryption (Node.js equivalent of CryptoJS implementation)
 */
function decryptHashId(id: string, hash: string): string | null {
  try {
    // Generate key and IV from id (equivalent to the browser pk function)
    const idHex = Buffer.from(id, 'utf8').toString('hex');
    const key = Buffer.from(idHex.substring(0, 16), 'utf8');
    const iv = Buffer.from(idHex.substring(2, 18), 'utf8');

    // Convert hex hash to buffer and then to base64 (equivalent to CryptoJS.enc.Base64.stringify)
    const hashBuffer = Buffer.from(hash, 'hex');
    const cipher = hashBuffer.toString('base64');

    // Decrypt using AES
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = decipher.update(cipher, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error('Decryption failed', { error: error as Error });
    return null;
  }
}

interface CandidateRemovalRequestBody {
  candidateEmail: string;
  candidateId: string;
}
