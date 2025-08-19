import { defaultLogger, Salesforce, SalesforceClient } from '@trilogy-group/xoh-integration';
import { stringify } from 'csv-stringify/sync';
import fs from 'node:fs';
import { Action, ActionData, AffectedApplicationsData, Application } from './logic/model';
import { calculateApplicationStepResultEffect } from './logic/sf-calculate-asr-effect';
import { findAffectedApplications } from './logic/sf-find-affected-applications';

Salesforce.silent();
const log = defaultLogger();

export async function sfCalculateApplicationFixes(asrIds: string[]) {
  const sf = await Salesforce.getAdminClient();
  const affectedApplications: AffectedApplicationsData[] = await findAffectedApplications(asrIds, sf);
  const actions: ActionData[] = [];
  for (let i = 0; i < affectedApplications.length; i++) {
    const affected = affectedApplications[i];

    // Let's assume we already fixed the ASR itself and it's score is already updated
    const newScore = affected.asr.Score__c;

    // Calculate the change effect
    calculateApplicationStepResultEffect(affected, newScore);

    log.info(
      `[${i + 1}/${affectedApplications.length}] ASR [${affected.asr.Id}] score update: ${
        affected.asr.Score__c
      } => ${newScore} (Raw: ${affected.asr.Raw_Score__c})`,
    );
    log.info(
      `  (${affected.asr.Score__c}; ${affected.asr.State__c}) :: (https://crossover.lightning.force.com/lightning/r/Application_Step_Result__c/${affected.asr.Id}/view)`,
    );
    affected.applications.forEach((app) => {
      log.info(`    - Affected app [${app.Id}; ${app.StageName}]: ${app.action} :: ${app.reason}`);
      if (app.action !== Action.None) {
        switch (app.action) {
          case Action.Error:
            log.info(`     [ACT] Check manually ${app.Id}`);
            break;
          case Action.Restore:
            log.info(`     [ACT] Restore application ${app.Id} to ${app.hint}`);
            break;
          case Action.Reject:
            log.info(`     [ACT] Reject application ${app.Id}`);
            break;
          case Action.NotifyHM:
            log.info(`     [ACT] Notify HM about application ${app.Id}`);
            break;
        }
        actions.push({
          action: app.action,
          appId: app.Id,
          hint: app.hint,
          candidate: {
            name: app.Account.Name,
            email: app.Account.PersonEmail,
            title: app.Advertised_Title__c,
          },
        });
      }
    });
  }

  log.info(`Save ${actions.length} actions to the file`);
  fs.writeFileSync(`./actions.json`, JSON.stringify(actions, null, 2), { encoding: 'utf8' });
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sfActOnActions() {
  const sf = await Salesforce.getAdminClient();
  const actions: ActionData[] = JSON.parse(fs.readFileSync('./actions.json', { encoding: 'utf-8' }));
  const csvReportRows: any[] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    switch (action.action) {
      case Action.Restore:
        {
          log.info(`[${i + 1}/${actions.length}] Restoring application ${action.appId} to stage ${action.hint}`);
          const currentStage = await sf.querySOQL<Application>(
            `SELECT StageName FROM Opportunity WHERE Id = '${action.appId}'`,
          );
          if (currentStage[0].StageName === action.hint) {
            log.info(`    Application is already in ${action.hint}`);
            continue;
          }
          await sf.updateObject('Opportunity', action.appId, {
            StageName: action.hint,
          });
          // Wait here, every update triggers flows, make sure we went through it
          await sleep(1000);

          // Application can be blocked here if we restored to the stage but all assessment for that stage has already been completed
          // We should call "GetNextApplicationAssessmentStage_subflow" to determine if we need to move further
          const nextStage = await getNextApplicationStage(action.appId, sf);
          if (nextStage != null && nextStage !== action.hint) {
            log.info(`    Moving to ${nextStage} based on calculated by GetNextApplicationAssessmentStage_subflow`);
            await sf.updateObject('Opportunity', action.appId, {
              StageName: nextStage,
            });
            // Wait here, every update triggers flows, make sure we went through it
            await sleep(1000);
          }
        }
        break;
      case Action.Reject:
        log.info(`[${i + 1}/${actions.length}] Rejecting application ${action.appId}`);
        await sf.updateObject('Opportunity', action.appId, {
          StageName: 'Rejected',
        });
        // Give a bit of time to make sure flows completed
        await sleep(500);
        break;
      case Action.NotifyHM:
        // Will be handled manually
        break;
    }

    csvReportRows.push({
      action: action.action,
      applicationId: action.appId,
      title: action.candidate.title,
      candidateEmail: action.candidate.email,
      candidateName: action.candidate.name,
    });
  }

  const csvData = stringify(csvReportRows);
  fs.writeFileSync('./csvReport.json', JSON.stringify(csvReportRows, null, 2), { encoding: 'utf-8' });
  fs.writeFileSync('./csvReport.csv', csvData, { encoding: 'utf-8' });
}

async function getNextApplicationStage(appId: string, sf: SalesforceClient): Promise<string | null> {
  const response = await sf.invokeFlow('GetNextApplicationAssessmentStage_subflow', {
    inputs: [
      {
        iVarT_ApplicationId: appId,
      },
    ],
  });
  if (response.data.isSuccess) {
    return response.data.outputValues.oVarT_ApplicationStage;
  } else {
    return null;
  }
}
