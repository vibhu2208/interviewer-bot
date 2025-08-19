import 'dotenv/config';
import { defaultLogger, Salesforce } from '@trilogy-group/xoh-integration';
import { gradeBMSubmission } from './handlers/grade-bm-submission';
import * as readline from 'readline';
import { insertGradingResult } from './integrations/xo-sf';

const log = defaultLogger({ serviceName: 'result' });

interface Application_Step_Result__c {
  Id: string;
  Grade_URL__c: string;
}

/**
 * Prompts the user with a yes/no question and returns their response
 * @param question The question to ask the user
 * @returns A promise that resolves to true for yes, false for no
 */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(`${question} (y/N): `, (answer: string) => {
      resolve(answer.trim().toLowerCase());
      rl.close();
    });
  });

  return answer === 'y' || answer === 'yes';
}

async function assignAndGrade(forceAsrId?: string): Promise<void> {
  Salesforce.silent();
  const sf = await Salesforce.getAdminClient();

  let asr: Application_Step_Result__c = null;

  if (forceAsrId != null) {
    const asrs = await sf.querySOQL<Application_Step_Result__c>(`
      SELECT Id,
             Grader__c,
             Grade_URL__c
      FROM Application_Step_Result__c
      WHERE Application_Step_Id__c = 'a08Ij0000000IWWIA2'
        AND Id = '${forceAsrId}'
      ORDER BY Submission_Time__c ASC LIMIT 1
  `);
    asr = asrs[0];
  } else {
    // 1. Query the next ASR available for Grading
    const asrs = await sf.querySOQL<Application_Step_Result__c>(`
      SELECT Id,
             Grader__c,
             Grade_URL__c
      FROM Application_Step_Result__c
      WHERE Application_Step_Id__c = 'a08Ij0000000IWWIA2'
        AND State__c = 'Waiting for Grading'
        AND Grader__c = '0052j000000ew8YAAQ'
      ORDER BY Submission_Time__c ASC LIMIT 1
  `);

    if (asrs.length === 0) {
      log.info(`No ASRs found available for grading!`);
      return;
    }

    asr = asrs[0];

    // Update the grader id
    await sf.updateObject('Application_Step_Result__c', asr.Id, {
      Grader__c: '0052j000000tY98AAE',
    });
  }

  // Start the grading
  try {
    log.info(`Grading ASR: ${asr.Id}`);
    const result = await gradeBMSubmission(asr.Id);
    if (result != null) {
      log.info(`Sheet link: ${result.submission.googleSheetLink}`);
      log.info(`Notebook link: ${result.submission.jupiterLink}`);
      log.info(`R1: ${result.rubric.first.score} (${result.rubric.first.reason})`);
      log.info(`R2: ${result.rubric.second.score} (${result.rubric.second.reason})`);
      log.info(`R3: ${result.rubric.third.score} (${result.rubric.third.reason})`);
      log.info(`Accuracy: Classification: ${result.sheet.classification}, Order: ${result.sheet.orderStatus}`);

      const shouldAddResults = await promptYesNo('Do you want to add these results?');

      if (shouldAddResults) {
        log.info('Adding results to the system...');
        await insertGradingResult(sf, asr.Id, result.rubric);
      } else {
        log.info('Results not added.');
      }
    } else {
      log.warn(`No grading result returned`);
    }
  } catch (e) {
    log.warn(`Error while grading: ${e}`);
  }
  log.info(`Grading Url: ${asr.Grade_URL__c}`);
}

(async () => {
  await assignAndGrade();
})();
