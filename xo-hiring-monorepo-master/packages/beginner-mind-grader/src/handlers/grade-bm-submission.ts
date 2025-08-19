import { defaultLogger, Salesforce, SalesforceClient } from '@trilogy-group/xoh-integration';
import { getAsrSubmission } from '../integrations/xo-sf';
import { gradeGoogleSheetSubmission } from './grade-google-sheet';
import { gradeJupyter } from './grade-jupyter';

const log = defaultLogger({ serviceName: 'grader' });

export interface BmSubmissionGradingResult {
  first: SubmissionGradingQuestion;
  second: SubmissionGradingQuestion;
  third: SubmissionGradingQuestion;
}

export interface SubmissionGradingQuestion {
  score: number;
  reason: string;
}

export interface BmSubmissionSheetGrading {
  classification: string;
  orderStatus: string;
}

export interface BmSubmission {
  asrId: string;
  googleSheetLink: string;
  jupiterLink: string;
}

export interface FinalGrading {
  rubric: BmSubmissionGradingResult;
  sheet: BmSubmissionSheetGrading;
  submission: BmSubmission;
}

export async function gradeBMSubmission(asrId: string): Promise<FinalGrading | null> {
  Salesforce.silent();
  const sf = await Salesforce.getAdminClient();
  const submission = await getBmSubmission(asrId, sf);
  try {
    const sheetGrading = await gradeGoogleSheetSubmission(submission);
    const jupyterGrading = await gradeJupyter(submission, sheetGrading);

    return {
      rubric: jupyterGrading,
      sheet: sheetGrading,
      submission,
    };
  } catch (e) {
    log.error(`Cannot grade ${asrId}: ${(e as Error).message}`);
    return {
      submission,
      sheet: {
        orderStatus: 'N/A',
        classification: 'N/A',
      },
      rubric: {
        first: {
          score: 0,
          reason: `${e.message}`,
        },
        second: {
          score: 0,
          reason: `${e.message}`,
        },
        third: {
          score: 0,
          reason: `${e.message}`,
        },
      },
    };
  }
}

async function getBmSubmission(asrId: string, sf: SalesforceClient): Promise<BmSubmission> {
  const asrData = await getAsrSubmission(asrId, sf);
  const jpLink = asrData?.submission?.find((it) => it.question.includes('Jupyter Notebook'))?.answer ?? null;
  const gdLink = asrData?.submission?.find((it) => it.question.includes('Google Sheets'))?.answer ?? null;
  if (jpLink == null) {
    throw new Error('Cannot find link to Jupyter Notebook');
  }
  if (gdLink == null) {
    throw new Error('Cannot find link to Google Sheets');
  }
  return {
    asrId,
    jupiterLink: jpLink,
    googleSheetLink: gdLink,
  };
}
