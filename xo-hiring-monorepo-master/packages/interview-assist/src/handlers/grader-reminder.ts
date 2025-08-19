import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';
import Handlebars from 'handlebars';
import { SendMailOptions, Transporter } from 'nodemailer';
import { Email } from '../integrations/ses';
import { Config } from '../models/config';
import { Interviewer } from '../models/interviewer';
import { graderReminderEmailTemplate } from './grader-reminder.email';

const log = defaultLogger({ serviceName: 'grader-reminder' });

/**
 * This handler runs daily to remind graders to enable Read AI integration.
 */
export async function handler() {
  log.info('Starting grader reminder process');

  let isDryRun = false;
  const config = await Config.fetch();
  if (config) {
    isDryRun = !config.sendReminderEmail;
  } else {
    log.info('Config not found. Assuming dry run.');
  }

  // Get eligible graders from previous day's interviews
  const eligibleGraders = await getEligibleGraders();
  const graderIds = Object.keys(eligibleGraders);

  if (graderIds.length === 0) {
    log.info('No graders to remind.');
    return;
  }

  // Get graders who already have Read AI integration (e.g. we received at least one transcript from them)
  const onboardedGraders = await Interviewer.getByIds(graderIds);

  // Filter out graders who already have Read AI integration
  const graderIdsToRemind = graderIds.filter(
    (id) => !onboardedGraders.some((it) => it.interviewerId === id && it.isOnboarded),
  );

  if (graderIdsToRemind.length === 0) {
    log.info('No graders to remind.');
    return;
  }

  const transporter = Email.getTransporter();

  log.info(`Sending reminder emails to ${graderIdsToRemind.length} graders`);

  for (const graderId of graderIdsToRemind) {
    await sendReminderEmail(transporter, eligibleGraders[graderId], isDryRun);
  }

  log.info('grader reminder process complete');
}

type Grader = {
  Grader__r: {
    Id: string;
    Email: string;
    Name: string;
  };
};

async function sendReminderEmail(transporter: Transporter, grader: Grader, isDryRun: boolean) {
  log.info('Sending reminder to the grader', { grader });

  try {
    const htmlEmailBody = Handlebars.compile(graderReminderEmailTemplate)({
      graderName: grader.Grader__r.Name,
      graderId: grader.Grader__r.Id,
    });

    const emailRequest: SendMailOptions = {
      from: 'Interview Assist <team@crossover.com>',
      replyTo: 'Interview Assist <team@crossover.com>',
      to: grader.Grader__r.Email,
      subject: 'Enable Interview Summaries for Your Crossover Interviews',
      html: htmlEmailBody,
    };

    if (!isDryRun) {
      await transporter.sendMail(emailRequest);
    } else {
      log.info('Dry run mode. Would have sent email', { emailRequest });
    }

    log.info('Reminder email sent to the grader', { grader });
  } catch (error) {
    log.error('Failed to send reminder to the grader', { grader, error });
  }
}

export async function getEligibleGraders(): Promise<{ [key: string]: Grader }> {
  log.info('Querying Salesforce for graders who had interviews yesterday');

  const sf = await Salesforce.getAdminClient();

  // Get canceled interviews from yesterday
  const canceledAsrIds = await sf.querySOQL<{ ObjectId__c: string }>(`
    SELECT ObjectId__c
    FROM CalendlyAction__c
    WHERE
      EventTypeName__c = 'Crossover Interview' AND
      EventStartTime__c = YESTERDAY AND
      Name = 'invitee.canceled'
  `);

  // Get interviews from yesterday that were not canceled
  const interviewAsrIds = await sf.querySOQL<{ ObjectId__c: string }>(`
    SELECT ObjectId__c
    FROM CalendlyAction__c
    WHERE 
      EventTypeName__c = 'Crossover Interview' AND
      EventStartTime__c = YESTERDAY AND
      ObjectId__c NOT IN (${formatIds(canceledAsrIds.map((it) => it.ObjectId__c))})
  `);

  // Get graders who had interviews from yesterday
  const graders = await sf.querySOQL<Grader>(`
    SELECT
      Grader__r.Id,
      Grader__r.Email,
      Grader__r.Name
    FROM Application_Step_Result__c
    WHERE Id IN (${formatIds(interviewAsrIds.map((it) => it.ObjectId__c))})
  `);

  // Ensure we have unique graders
  // Create dictionary with grader ID as key and object as value
  const uniqueGraders = graders.reduce((acc, grader) => {
    acc[grader.Grader__r.Id] = grader;
    return acc;
  }, {} as Record<string, Grader>);

  return uniqueGraders;
}

function formatIds(ids: string[]) {
  if (!ids || ids.length === 0) {
    ids = [''];
  }

  return ids
    .filter(Boolean)
    .map((id) => `'${id}'`)
    .join(',');
}
