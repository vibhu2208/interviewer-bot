import { defaultLogger, Ssm, Salesforce } from '@trilogy-group/xoh-integration';
import { DateTime } from 'luxon';
import Handlebars from 'handlebars';
import { createTransport, SendMailOptions } from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { GRADING_ESCALATION_EMAIL_TEMPLATE } from '../templates/grading-escalation.email.template';

const log = defaultLogger({ serviceName: 'grading-escalation-service' });
const sesClient = new SESv2Client({
  region: 'us-east-1',
  credentials: defaultProvider(),
});
const transporter = createTransport({
  SES: { sesClient, SendEmailCommand },
});

// Configuration interface
export interface EscalationConfig {
  brands: string[];
  sla_days: {
    rwa_grading: number;
    interview_grading: number;
  };
  recipients: {
    cc: string[];
    ignore: string[];
  };
}

// Escalation task item for emails
export interface EscalationTaskItem {
  taskId: string;
  whatId: string;
  subject: string;
  whatName: string;
  candidateName: string;
  submissionDate: string;
  daysOverdue: number;
  profileLink: string;
  workUnitType: string;
  taskType: TaskType; // Add task type for email template differentiation
  // Stakeholder emails for CC
  accountableBusinessExecutive?: string;
  primaryHiringManager?: string;
  hiringManager?: string;
}

// Email template data
interface EmailTemplateData {
  assignee: {
    firstName: string;
  };
  initial_items: Array<{
    link: string;
    subject: string;
    candidate: string;
    profileLink: string;
    date: string;
    days: number;
    taskType: string; // "RWA" or "INTERVIEW" for Handlebars conditional logic
  }>;
  followup_items: Array<{
    link: string;
    subject: string;
    candidate: string;
    profileLink: string;
    date: string;
    days: number;
    taskType: string; // "RWA" or "INTERVIEW" for Handlebars conditional logic
  }>;
}

// Prepared email data
export interface PreparedEmail {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}

// Task types for escalation
export enum TaskType {
  RWA = 'RWA',
  INTERVIEW = 'INTERVIEW',
  UNKNOWN = 'UNKNOWN',
}

// Grader with overdue tasks
export interface GraderEscalation {
  grader: {
    id: string;
    firstName: string;
    fullName: string;
    email: string;
  };
  initialItems: EscalationTaskItem[]; // Just breached SLA
  followupItems: EscalationTaskItem[]; // 24+ hours overdue
}

// Grading task interface
export interface GradingTask {
  Id: string;
  Subject: string;
  Work_Unit_Backlog_Name__c: string;
  ActivityDate: string;
  Owner: {
    FirstName: string;
    Name: string;
    Email: string;
  };
  Status: string;
  WhatId: string;
  What: {
    // For Application_Step_Result__c
    Name: string;
    ApplicationId__r: {
      Pipeline__r: {
        Status__c: string;
        Brand__r: {
          Name: string;
        };
        OwnerId__r: {
          // Accountable Business Executive
          Email: string;
        };
        Primary_Hiring_Manager__r: {
          // Primary Hiring Manager
          Email: string;
        };
        ManagerId__r: {
          // Hiring Manager
          Email: string;
        };
      };
      StageName: string;
      Account: {
        Id: string;
        Profile_360__c: string;
        Name: string;
      };
    };
    Application_Stage__c: string;
    Submission_Time__c: string;
    Scheduled_For_Time__c: string | null;
  };
}

export class GradingEscalationService {
  private config: EscalationConfig | null = null;
  private adminPortalUrl: string | null = null;

  /**
   * Load escalation configuration from SSM Parameter Store
   */
  async loadConfiguration(): Promise<void> {
    const parameterName = process.env.ESCALATION_CONFIG_PARAM;

    if (!parameterName) {
      throw new Error('ESCALATION_CONFIG_PARAM environment variable is not set');
    }

    log.info(`Loading escalation configuration from SSM parameter: ${parameterName}`);

    this.config = await Ssm.fetchParameterJson(parameterName);

    if (this.config == null) {
      throw new Error(`SSM parameter ${parameterName} not found or has no value`);
    }

    log.info('Successfully loaded escalation configuration', {
      config: this.config,
    });
  }

  /**
   * Load admin portal URL from Salesforce custom settings
   */
  async loadAdminPortalUrl(): Promise<void> {
    if (this.adminPortalUrl !== null) {
      return; // Already loaded
    }

    const sf = await Salesforce.getAdminClient();

    const result = await sf.querySOQL<{ Admin_Portal_Url__c: string }>(`
      SELECT Admin_Portal_Url__c
      FROM XO_Platform__c LIMIT 1
    `);
    this.adminPortalUrl = result[0].Admin_Portal_Url__c;

    log.info(`Loaded admin portal URL: ${this.adminPortalUrl}`);
  }

  /**
   * Query uncompleted grading tasks from Salesforce
   */
  async queryGradingTasks(): Promise<GradingTask[]> {
    const sf = await Salesforce.getAdminClient();

    const query = `
      SELECT 
          Id, 
          Subject,
          Work_Unit_Backlog_Name__c,
          ActivityDate, 
          Owner.FirstName,
          Owner.Name,
          Owner.Email,
          Status,
          WhatId,
          TYPEOF What
              WHEN Application_Step_Result__c THEN
                  Name,
                  ApplicationId__r.Pipeline__r.Status__c,
                  ApplicationId__r.Pipeline__r.Brand__r.Name,
                  ApplicationId__r.Pipeline__r.OwnerId__r.Email,
                  ApplicationId__r.Pipeline__r.Primary_Hiring_Manager__r.Email,
                  ApplicationId__r.Pipeline__r.ManagerId__r.Email,
                  ApplicationId__r.Account.Id,
                  ApplicationId__r.Account.Profile_360__c,
                  ApplicationId__r.Account.Name,
                  ApplicationId__r.StageName,
                  Application_Stage__c,
                  Submission_Time__c,
                  Scheduled_For_Time__c
              WHEN Opportunity THEN 
                  Account.Id,
                  Account.Profile_360__c,
                  Account.Name
              END
      FROM Task
      WHERE Status != 'Completed'
      AND What.Type = 'Application_Step_Result__c'
      AND Work_Unit_Backlog_Name__c != NULL
      ORDER BY ActivityDate ASC
    `;

    log.info('Querying uncompleted grading tasks');

    const results = await sf.querySOQL<GradingTask>(query);

    log.info(`Query returned ${results.length} uncompleted grading tasks`);

    return results;
  }

  /**
   * Calculate business days between two dates (excluding weekends)
   */
  private calculateBusinessDaysSince(startDate: DateTime): number {
    const now = DateTime.now().setZone('America/New_York');
    const adjustedStartDate = startDate.setZone('America/New_York');

    let businessDays = 0;
    let currentDate = adjustedStartDate.plus({ days: 1 }); // Start from next day

    while (currentDate < now) {
      // Skip weekends (Saturday = 6, Sunday = 7)
      if (currentDate.weekday <= 5) {
        businessDays++;
      }
      currentDate = currentDate.plus({ days: 1 });
    }

    return businessDays;
  }

  /**
   * Get the appropriate date to measure SLA from based on task type
   */
  private getTaskSlaStartDate(task: GradingTask): DateTime | null {
    const taskType = this.getTaskType(task);

    // For RWA tasks (SMQ/FRQ): use submission time
    if (taskType === TaskType.RWA) {
      if (!task.What.Submission_Time__c) {
        return null;
      }
      return DateTime.fromISO(task.What.Submission_Time__c);
    }

    // For Interview tasks: use scheduled time
    if (taskType === TaskType.INTERVIEW) {
      if (!task.What.Scheduled_For_Time__c) {
        return null; // No scheduled time means no overdue
      }
      return DateTime.fromISO(task.What.Scheduled_For_Time__c);
    }

    return null;
  }

  /**
   * Determine the task type based on application stage
   */
  private getTaskType(task: GradingTask): TaskType {
    const stage = task.What.Application_Stage__c;

    if (stage === 'SMQ' || stage === 'FRQ') {
      return TaskType.RWA;
    } else if (stage === 'Interview') {
      return TaskType.INTERVIEW;
    }

    return TaskType.UNKNOWN;
  }

  /**
   * Determine SLA days for a task based on its type and stage
   */
  private getSlaForTask(task: GradingTask): number | null {
    if (!this.config) return null;

    const taskType = this.getTaskType(task);

    if (taskType === TaskType.RWA) {
      return this.config.sla_days.rwa_grading;
    } else if (taskType === TaskType.INTERVIEW) {
      return this.config.sla_days.interview_grading;
    }

    return null;
  }

  /**
   * Check if task is from a configured brand
   */
  private isFromConfiguredBrand(task: GradingTask): boolean {
    if (!this.config || !task.What.ApplicationId__r) return false;

    const brandName = task.What.ApplicationId__r.Pipeline__r.Brand__r.Name;
    return this.config.brands.includes(brandName);
  }

  /**
   * Check if task pipeline status is valid for escalation based on task type
   *
   * Salesforce Pipeline Status API Names:
   * - Active (Label: Active Open)
   * - Hidden (Label: Hidden)
   * - On Hold (Label: On Hold)
   * - Closed (Label: Closed)
   * - Setting Up (Label: Setting Up)
   */
  private isPipelineStatusValid(task: GradingTask): boolean {
    if (!task.What.ApplicationId__r) return false;

    const pipelineStatus = task.What.ApplicationId__r.Pipeline__r.Status__c;
    const taskType = this.getTaskType(task);

    // For RWA tasks (SMQ/FRQ): only include Active or Hidden
    if (taskType === TaskType.RWA) {
      const isValid = pipelineStatus === 'Active' || pipelineStatus === 'Hidden';
      log.debug(`  RWA pipeline status check: ${pipelineStatus} -> ${isValid}`);
      return isValid;
    }

    // For Interview tasks: include Active, Hidden, or On Hold
    if (taskType === TaskType.INTERVIEW) {
      const isValid = pipelineStatus === 'Active' || pipelineStatus === 'Hidden' || pipelineStatus === 'On Hold';
      log.debug(`  Interview pipeline status check: ${pipelineStatus} -> ${isValid}`);
      return isValid;
    }

    log.debug(`  Unknown task type: ${taskType}`);
    return false;
  }

  /**
   * Check if application stage is valid for escalation
   * Only applies to Interview tasks - exclude Interview tasks for applications that are Canceled or Rejected
   * RWA tasks are not filtered by application stage
   */
  private isApplicationStageValid(task: GradingTask): boolean {
    if (!task.What.ApplicationId__r) return false;

    const stageName = task.What.ApplicationId__r.StageName;

    const isValid = stageName !== 'Canceled' && stageName !== 'Rejected';
    log.debug(`  Interview application stage check: ${stageName} -> ${isValid}`);
    return isValid;
  }

  private taskToEmailData(item: EscalationTaskItem): any {
    // Avoid duplication if subject already contains whatName
    const subject = item.whatName.toLowerCase().includes(item.subject.toLowerCase())
      ? item.whatName
      : `${item.subject}: ${item.whatName}`;

    return {
      link: `${this.adminPortalUrl}/admin/tasks?whatId=${item.whatId}`,
      subject,
      candidate: item.candidateName,
      profileLink: item.profileLink,
      date: item.submissionDate,
      days: item.daysOverdue,
      taskType: item.taskType,
    };
  }

  /**
   * Process tasks and identify overdue ones grouped by grader
   */
  calculateOverdueTasks(tasks: GradingTask[]): GraderEscalation[] {
    const graderMap = new Map<string, GraderEscalation>();

    for (const task of tasks) {
      const taskType = this.getTaskType(task);
      log.debug(`Processing task ${task.Id} (${task.Status}; ${task.Subject}; ${task.Owner.Name}; Type: ${taskType})`);

      // Get the appropriate start date for SLA calculation based on task type
      const slaStartDate = this.getTaskSlaStartDate(task);
      if (!slaStartDate) {
        log.debug(
          `  Skip: Missing SLA start date (${taskType === TaskType.RWA ? 'submission time' : 'scheduled time'})`,
        );
        continue;
      }

      if (!this.isFromConfiguredBrand(task)) {
        log.debug(`  Skip: Brand is not configured`);
        continue;
      }
      if (!this.isPipelineStatusValid(task)) {
        log.debug(`  Skip: Pipeline status is not valid for escalation`);
        continue;
      }
      if (!this.isApplicationStageValid(task)) {
        log.debug(`  Skip: Application stage is not valid for escalation`);
        continue;
      }

      const slaDays = this.getSlaForTask(task);
      if (slaDays === null) {
        log.debug(`  Skip: Missing SLA limit for task`);
        continue;
      }

      const businessDaysSince = this.calculateBusinessDaysSince(slaStartDate);

      // Check if task is overdue
      if (businessDaysSince < slaDays) {
        log.debug(`  Skip: Task is not overdue (${businessDaysSince} < ${slaDays})`);
        continue;
      }

      // Create escalation item
      const escalationItem: EscalationTaskItem = {
        taskId: task.Id,
        whatId: task.WhatId,
        subject: task.Subject,
        whatName: task.What.Name,
        candidateName: task.What.ApplicationId__r.Account.Name,
        submissionDate: slaStartDate.toFormat('yyyy-MM-dd'),
        daysOverdue: businessDaysSince,
        profileLink: task.What.ApplicationId__r.Account.Profile_360__c || '',
        workUnitType: task.Work_Unit_Backlog_Name__c,
        taskType: taskType,
        // Stakeholder emails for CC
        accountableBusinessExecutive: task.What.ApplicationId__r.Pipeline__r.OwnerId__r?.Email,
        primaryHiringManager: task.What.ApplicationId__r.Pipeline__r.Primary_Hiring_Manager__r?.Email,
        hiringManager: task.What.ApplicationId__r.Pipeline__r.ManagerId__r?.Email,
      };

      // Group by grader
      const graderId = task.Owner.Email;
      let escalation: GraderEscalation | undefined = graderMap.get(graderId);
      if (escalation == null) {
        escalation = {
          grader: {
            id: graderId,
            firstName: task.Owner.FirstName,
            fullName: task.Owner.Name,
            email: task.Owner.Email,
          },
          initialItems: [],
          followupItems: [],
        };
        graderMap.set(graderId, escalation);
      }

      // Categorize based on days overdue
      // Initial: just breached SLA (slaDays + 1 day)
      // Followup: Everything more
      if (businessDaysSince < slaDays + 1) {
        escalation.initialItems.push(escalationItem);
      } else {
        escalation.followupItems.push(escalationItem);
      }
    }

    const result = Array.from(graderMap.values());

    log.info(`Processed ${tasks.length} tasks, found ${result.length} graders with overdue items`, {
      totalOverdueItems: result.reduce((sum, g) => sum + g.initialItems.length + g.followupItems.length, 0),
    });

    return result;
  }

  /**
   * Prepare escalation email for a grader
   */
  private prepareEscalationEmail(escalation: GraderEscalation): PreparedEmail | null {
    if (this.config == null) {
      throw new Error('Configuration must be loaded before sending emails');
    }

    // Skip if grader is in ignore list
    if (this.config.recipients.ignore.includes(escalation.grader.email)) {
      log.info(`Skipping ignored grader: ${escalation.grader.email}`);
      return null;
    }

    // Skip if grader email is invalid (sandbox)
    if (escalation.grader.email.endsWith('.invalid')) {
      log.info(`Skipping invalid grader email: ${escalation.grader.email}`);
      return null;
    }

    // Convert items to template format
    const initial_items = escalation.initialItems.map((item) => this.taskToEmailData(item));
    const followup_items = escalation.followupItems.map((item) => this.taskToEmailData(item));

    // Prepare template data
    const templateData: EmailTemplateData = {
      assignee: {
        firstName: escalation.grader.firstName,
      },
      initial_items,
      followup_items,
    };

    // Register Handlebars helper for equality comparison
    Handlebars.registerHelper('eq', function (a, b) {
      return a === b;
    });

    // Render email
    const template = Handlebars.compile(GRADING_ESCALATION_EMAIL_TEMPLATE, {
      noEscape: true,
    });
    const emailBody = template(templateData);

    // Determine subject and recipients
    const hasFollowupItems = followup_items.length > 0;
    const subject = hasFollowupItems
      ? 'Crossover Escalation – SLA Breach Over 24 Hours'
      : 'Crossover Escalation – SLA Breach';

    const toEmails = [escalation.grader.email];
    const ccEmails: string[] = [];

    // Add CC recipients if there are 24h overdue tasks
    if (hasFollowupItems) {
      ccEmails.push(...this.config.recipients.cc);

      // Add stakeholder emails from all tasks (PM, PHM, ABE) unless they are the assignee
      const allTasks = [...escalation.initialItems, ...escalation.followupItems];
      const stakeholderEmails = new Set<string>();

      for (const task of allTasks) {
        if (task.accountableBusinessExecutive) {
          stakeholderEmails.add(task.accountableBusinessExecutive);
        }
        if (task.primaryHiringManager) {
          stakeholderEmails.add(task.primaryHiringManager);
        }
        if (task.hiringManager) {
          stakeholderEmails.add(task.hiringManager);
        }
      }

      // Filter out the assignee's email and ignored emails, then add to CC
      const filteredStakeholderEmails = Array.from(stakeholderEmails).filter(
        (email) => email !== escalation.grader.email && !this.config?.recipients.ignore.includes(email),
      );

      ccEmails.push(...filteredStakeholderEmails);
    }

    // Remove ignored emails from CC
    const filteredCcEmails = ccEmails.filter((email) => !this.config?.recipients.ignore.includes(email));

    // Return prepared email data
    return {
      to: toEmails,
      cc: filteredCcEmails,
      subject,
      body: emailBody,
    };
  }

  /**
   * Prepare escalation emails for all graders with overdue tasks
   */
  prepareEscalationEmails(graderEscalations: GraderEscalation[]): PreparedEmail[] {
    log.info(`Preparing escalation emails for ${graderEscalations.length} graders`);

    const preparedEmails: PreparedEmail[] = [];

    for (const escalation of graderEscalations) {
      try {
        const preparedEmail = this.prepareEscalationEmail(escalation);
        if (preparedEmail) {
          preparedEmails.push(preparedEmail);
        }
      } catch (error) {
        log.error(`Failed to prepare email for ${escalation.grader.email}`, { error });
      }
    }

    log.info(`Prepared ${preparedEmails.length} escalation emails`);

    return preparedEmails;
  }

  /**
   * Send all prepared escalation emails
   */
  async sendEscalationEmails(preparedEmails: PreparedEmail[]): Promise<void> {
    if (preparedEmails.length === 0) {
      log.info('No emails to send');
      return;
    }

    log.info(`Sending ${preparedEmails.length} escalation emails`);

    await Promise.all(
      preparedEmails.map(async (preparedEmail) => {
        try {
          const mailOptions: SendMailOptions = {
            from: 'team@crossover.com',
            to: preparedEmail.to,
            cc: preparedEmail.cc.length > 0 ? preparedEmail.cc : undefined,
            subject: preparedEmail.subject,
            html: preparedEmail.body,
          };

          log.info(`Sending email to ${preparedEmail.to.join(', ')}`);
          await transporter.sendMail(mailOptions);
          log.info(`Email sent successfully to ${preparedEmail.to.join(', ')}`);
        } catch (error) {
          log.error(`Failed to send email to ${preparedEmail.to.join(', ')}`, { error });
        }
      }),
    );

    log.info(`Email sending completed`);
  }

  /**
   * Run the escalation check process
   */
  async runEscalationCheck(): Promise<void> {
    log.info('Starting grading escalation check');

    await this.loadConfiguration();
    await this.loadAdminPortalUrl();

    log.info('Configuration loaded successfully, escalation check ready to proceed');

    // Query uncompleted grading tasks
    const gradingTasks = await this.queryGradingTasks();

    if (gradingTasks.length === 0) {
      log.info('No uncompleted grading tasks found');
      return;
    }

    log.info(`Found ${gradingTasks.length} uncompleted grading tasks`);

    // Process tasks and identify overdue ones
    const graderEscalations = this.calculateOverdueTasks(gradingTasks);

    if (graderEscalations.length === 0) {
      log.info('No overdue tasks found for escalation');
      return;
    }

    log.info(`Found ${graderEscalations.length} graders with overdue tasks`);

    // Prepare escalation emails
    const preparedEmails = this.prepareEscalationEmails(graderEscalations);

    if (preparedEmails.length > 0) {
      // Send escalation emails
      await this.sendEscalationEmails(preparedEmails);
    }

    log.info(`Grading escalation check completed successfully`);
  }
}
