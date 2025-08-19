import { APIGatewayProxyEvent } from 'aws-lambda';
import axios, { AxiosResponse } from 'axios';
import { logger } from '../logger';
import { query } from '../resources/salesforce-query';
import { createSObject } from '../resources/salesforce-sobjects';
import { axiosResponse, HttpStatusCodes } from '../responses';
import { SSMConfig } from '../ssm-config';
import { Secrets } from './integrations/secrets';

export class Cases {
  public static async createCase(event: APIGatewayProxyEvent): Promise<AxiosResponse> {
    // Fetch SSM Config
    const config = await SSMConfig.getForEnvironment();
    const errors: string[] = [];

    // Create SF case
    if (config.cases.mode.includes('sf')) {
      try {
        logger.info(`Creating case in Salesforce`);
        await createSObject(event, 'Case');
      } catch (e) {
        logger.error(`Cannot create Salesforce case`, e as Error);
        errors.push(`sf: ${e}`);
      }
    }

    // Create Zendesk case
    if (config.cases.mode.includes('zendesk')) {
      try {
        logger.info(`Creating case in Zendesk`);
        const input: CaseInput = JSON.parse(event.body ?? '{}');
        logger.info(`Input`, { input });
        if (input.AccountId == null || input.AccountId.length === 0) {
          throw new Error('Input AccountId is not provided');
        }

        // Fetch user information from the Salesforce
        const queryResponse = await query(
          event,
          `SELECT Name, PersonEmail FROM Account WHERE Id = '${input.AccountId}'`,
        );
        const accountRecord = queryResponse.data?.records?.[0];
        if (!accountRecord) {
          throw new Error(`Account information for id ${input.AccountId} not found`);
        }

        await Cases.createZendeskCase(input, accountRecord);
      } catch (e) {
        logger.error(`Cannot create Zendesk case`, e as Error);
        errors.push(`zendesk: ${e}`);
      }
    }

    if (errors.length > 0) {
      return axiosResponse(HttpStatusCodes.BadRequest, {
        message: `Cannot create case: ${errors.join(';')}`,
      });
    }

    return axiosResponse(HttpStatusCodes.Ok);
  }

  private static async createZendeskCase(input: CaseInput, account: Account__c): Promise<void> {
    if (!process.env.ZENDESK_SECRET_NAME) {
      throw new Error(`ZENDESK_SECRET_NAME env variable should be defined`);
    }
    const zendeskSecret = await Secrets.fetchJsonSecret<ZendeskSecret>(process.env.ZENDESK_SECRET_NAME);

    const ticketBody = `
<h4>${input.Category__c}</h4>
<p>${input.Description}</p>
<br>
<a href="${process.env.SF_BASE_URL}/lightning/_classic/${input.AccountId}">View Candidate Profile</a><br>
<a href="${process.env.SF_BASE_URL}/lightning/_classic/${input.Application__c}">View Application</a><br>
<br>
<h4>Technical Information</h4>
<ul>
    <li><strong>IP:</strong> ${input.IP__c}</li>
    <li><strong>Browser Name:</strong> ${input.Browser_Name__c}</li>
    <li><strong>Browser Version:</strong> ${input.Browser_Version__c}</li>
    <li><strong>Device Model:</strong> ${input.Device_Model__c}</li>
    <li><strong>Device Type:</strong> ${input.Device_Type__c}</li>
    <li><strong>Device Vendor:</strong> ${input.Device_Vendor__c}</li>
    <li><strong>OS Name:</strong> ${input.OS_Name__c}</li>
    <li><strong>OS Version:</strong> ${input.OS_Version__c}</li>
    <li><strong>Screen Resolution:</strong> ${input.Screen_Resolution__c}</li>
    <li><strong>Screen Resolution Available:</strong> ${input.Screen_Resolution_Available__c}</li>
</ul>`.trim();

    const requestBody = {
      data: {
        ticket: {
          comment: {
            html_body: ticketBody,
            public: false,
          },
          subject: input.Subject,
          brand_id: 13877446523666,
          requester: {
            locale_id: 1,
            name: account.Name,
            email: account.PersonEmail,
          },
          type: 'problem',
          tags: ['xo_hire_webapp'],
        },
      },
      source: 'Crossover Web Application - Need Help? Button',
      destination: 'central-supportdesk',
      FriendlyServiceName: 'Crossover Hire Ticket Creation for Application Support Requests',
    };

    logger.info(`Performing zendesk case creation with the following body`, {
      requestBody,
    });

    const response = await axios.request({
      url: zendeskSecret.endpoint,
      method: 'post',
      auth: {
        username: zendeskSecret.username,
        password: zendeskSecret.password,
      },
      data: requestBody,
    });

    logger.info(`Zendesk response (status ${response.status})`, {
      data: response.data,
    });
  }
}

interface ZendeskSecret {
  endpoint: string;
  username: string;
  password: string;
}

interface CaseInput {
  AccountId: string;
  Application__c: string;
  Category__c: string;
  Description: string;
  Subject: string;
  Status: string;
  Origin: string;
  ContactId: string;
  Application_Stage__c: string;
  IP__c: string;
  Pipeline__c: string;
  Pipeline_Manager__c: string;
  Browser_Name__c: string;
  Browser_Version__c: string;
  Device_Model__c: string;
  Device_Type__c: string;
  Device_Vendor__c: string;
  OS_Name__c: string;
  OS_Version__c: string;
  Screen_Resolution__c: string;
  Screen_Resolution_Available__c: string;
}

interface Account__c {
  Name: string;
  PersonEmail: string;
}
