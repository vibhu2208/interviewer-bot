import { DateTime } from 'luxon';
import { Action, AffectedApplicationsData, AllStages, Application, ApplicationStepResult, IgnoreStages } from './model';

/**
 * Given the prepared information for the ASR and affected applications calculate if any action should be performed
 * due to the new ASR score
 * @param affected
 * @param newScore
 */
export function calculateApplicationStepResultEffect(
  affected: AffectedApplicationsData,
  newScore: number,
): AffectedApplicationsData {
  const asr = affected.asr;

  for (const app of affected.applications) {
    if (IgnoreStages.includes(app.StageName)) {
      app.action = Action.None;
      app.reason = `Application is ${app.StageName}`;
      continue;
    }

    const passScore = isPassScore(app, asr, newScore);

    if (app.StageName === 'Rejected') {
      // We want to check if this was an incorrect rejection or not
      if (wasTheApplicationRejectedDueToAsr(app, asr)) {
        // Ok, this ASR was the reason, but did the situation change with the new score?
        if (passScore) {
          app.action = Action.Restore;
          app.reason = `The new score is above threshold: ${app.comment}`;
          // Determine what stage should we restore the application to
          if (app.Last_Active_Stage__c != null) {
            app.hint = app.Last_Active_Stage__c;
          } else {
            app.action = Action.Error;
            app.reason = `Cannot determine the step we should restore application to, Last_Active_Stage__c is null`;
          }
        } else {
          app.action = Action.None;
          app.reason = `The new score is still below threshold: ${app.comment}`;
        }
      } else {
        // Since our ASR was not a problem we can move on
        app.action = Action.None;
        app.reason = `The application rejection has not been caused by this ASR`;
      }
    } else {
      // It can be that the new score is lower than it should be, and we need to reject the application
      if (passScore) {
        app.action = Action.None;
        app.reason = `The new score is still above threshold: ${app.comment}`;
      } else {
        const currentStageIdx = AllStages.indexOf(app.StageName);
        const interviewIdx = AllStages.indexOf('Interview');
        if (currentStageIdx >= interviewIdx) {
          app.action = Action.NotifyHM;
          app.reason = `Application should be rejected, but already past Review (the new score is below threshold: ${app.comment})`;
        } else {
          app.action = Action.Reject;
          app.reason = `The new score is below threshold: ${app.comment}`;
        }
      }
    }
  }

  return affected;
}

/**
 * Approximation of the CalculateBadgeStateService.calculate logic
 * Ignore retries (only used in CCAT), only calculate based on badges and thresholds
 * Note: In SF the ASR can fail but may not lead to application rejection (if the score if between desired and rejection)
 */
export function isPassScore(app: Application, asr: ApplicationStepResult, newScore: number): boolean {
  if (asr.Badge_Simulated__c == 'No' && app.aspm.Minimum_Proficiency__r?.Stars__c != null) {
    // Calculating by badge
    app.comment = `New score (${newScore}) vs required Badge Proficiency (${app.aspm.Minimum_Proficiency__r.Pass_Threshold__c})`;
    return newScore >= app.aspm.Minimum_Proficiency__r.Pass_Threshold__c;
  } else {
    // Calculating by threshold
    app.comment = `New score (${newScore}) vs required Threshold (${app.aspm.Reject_Threshold__c})`;
    return newScore >= app.aspm.Reject_Threshold__c;
  }
}

export function wasTheApplicationRejectedDueToAsr(app: Application, asr: ApplicationStepResult): boolean {
  if (app.StageName !== 'Rejected') {
    return false;
  }

  const asrHistory = asr.history;
  const appHistory = app.history;

  // Find date of ASR transition to Failed
  let asrTransitionToFailedDate = asrHistory.find(
    (record) => record.Field === 'State__c' && record.NewValue === 'Result_Failed',
  )?.CreatedDate;
  if (asrTransitionToFailedDate == null) {
    // In this case try to find transition to any result state
    asrTransitionToFailedDate = asrHistory.find(
      (record) => record.Field === 'State__c' && record.NewValue.startsWith('Result_'),
    )?.CreatedDate;
  }
  // Find date of Application transition to Rejected
  const appTransitionToRejectedDate = appHistory.find(
    (record) => record.Field === 'StageName' && record.NewValue === 'Rejected',
  )?.CreatedDate;
  if (appTransitionToRejectedDate == null) {
    // It may be possible that we have no specific history for this transition
    // But it mostly means that it is too old
    app.comment = `Cannot identify history for application transition to rejected`;
  } else {
    const appDt = DateTime.fromISO(appTransitionToRejectedDate!);
    const asrDt = DateTime.fromISO(asrTransitionToFailedDate!);
    const diff = Math.round(Math.abs(asrDt.diff(appDt).as('minutes')));
    // app.comment = `Time diff between ASR change and Application change is ${diff} min`;
    if (diff === 0) {
      return true;
    }
  }

  return false;
}
