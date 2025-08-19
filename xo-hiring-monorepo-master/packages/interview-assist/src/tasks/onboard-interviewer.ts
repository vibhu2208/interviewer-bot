import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';
import { Interviewer } from '../models/interviewer';

const log = defaultLogger({ serviceName: 'summary-generator' });
Salesforce.silent();

/**
 * Onboard an interviewer for a transcript
 * @param transcriptId - The ID of the transcript
 */
export async function onboardInterviewer(transcriptId: string): Promise<void> {
  // transcript ID is ASR ID in Salesforce

  const sf = await Salesforce.getDefaultClient();

  // Get ASR grader ID from Salesforce
  const result = await sf.querySOQL<{ Grader__c: string }>(
    `SELECT Grader__c FROM Application_Step_Result__c WHERE Id = '${transcriptId}' LIMIT 1`,
  );

  if (!result || result.length === 0) {
    log.error(`No ASR grader found for transcript ${transcriptId}`);
    return;
  }

  // Onboard interviewer
  await Interviewer.upsert({
    interviewerId: result[0].Grader__c,
    isOnboarded: true,
  });

  log.info(`Saved interviewer ${result[0].Grader__c}`);
}
