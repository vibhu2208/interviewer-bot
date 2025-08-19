import { defaultLogger } from '@trilogy-group/xoh-integration';
import { GoogleSheets, SheetData } from '../integrations/google-sheet';
import { BmSubmission, BmSubmissionSheetGrading } from './grade-bm-submission';

const log = defaultLogger({ serviceName: 'sheet-grader' });

interface EmailCategory {
  emailId: string;
  category: string;
}

const EmailClassification: EmailCategory[] = [
  { emailId: 'E001', category: 'order request' },
  { emailId: 'E002', category: 'order request' },
  { emailId: 'E003', category: 'product inquiry' },
  { emailId: 'E004', category: 'order request' },
  { emailId: 'E005', category: 'product inquiry' },
  { emailId: 'E006', category: 'product inquiry' },
  { emailId: 'E007', category: 'order request' },
  { emailId: 'E008', category: 'order request' },
  { emailId: 'E009', category: 'product inquiry' },
  { emailId: 'E010', category: 'order request' },
  { emailId: 'E011', category: 'product inquiry' },
  { emailId: 'E012', category: 'product inquiry' },
  { emailId: 'E013', category: 'order request' },
  { emailId: 'E014', category: 'order request' },
  { emailId: 'E015', category: 'product inquiry' },
  { emailId: 'E016', category: 'product inquiry' },
  { emailId: 'E017', category: 'product inquiry' },
  { emailId: 'E018', category: 'order request' },
  { emailId: 'E019', category: 'order request' },
  { emailId: 'E020', category: 'product inquiry' },
  { emailId: 'E021', category: 'product inquiry' },
  { emailId: 'E022', category: 'product inquiry' },
  { emailId: 'E023', category: 'product inquiry' },
];

interface OrderData {
  emailId: string;
  productId: string;
  quantity: number;
  status: string;
}

const ExpectedOrderData: OrderData[] = [
  { emailId: 'E001', productId: 'LTH0976', quantity: 4, status: 'created' },
  { emailId: 'E002', productId: 'VBT2345', quantity: 1, status: 'created' },
  { emailId: 'E004', productId: 'SFT1098', quantity: 3, status: 'created' },
  { emailId: 'E007', productId: 'CLF2109', quantity: 5, status: 'out of stock' },
  { emailId: 'E007', productId: 'FZZ1098', quantity: 2, status: 'created' },
  { emailId: 'E008', productId: 'VSC6789', quantity: 1, status: 'created' },
  { emailId: 'E010', productId: 'RSG8901', quantity: 1, status: 'created' },
  { emailId: 'E013', productId: 'SLD7654', quantity: 1, status: 'created' },
  { emailId: 'E014', productId: 'SWL2345', quantity: 1, status: 'created' },
  { emailId: 'E018', productId: 'RSG8901', quantity: 2, status: 'out of stock' },
  { emailId: 'E019', productId: 'CBT8901', quantity: 1, status: 'created' },
];

export async function gradeGoogleSheetSubmission(submission: BmSubmission): Promise<BmSubmissionSheetGrading> {
  const docId = GoogleSheets.extractSpreadsheetId(submission.googleSheetLink);

  const sheetNames = ['email-classification', 'order-status'];
  const sheets = await GoogleSheets.getSheetsByName(docId, sheetNames);

  const emailClassification = sheets.find((sheet) => sheet.title === 'email-classification');
  const orderStatus = sheets.find((sheet) => sheet.title === 'order-status');

  let emailScore;
  let orderScore;

  if (emailClassification == null) {
    log.warn(`Cannot find email classification sheet`);
    emailScore = `Not provided`;
  } else {
    const emailNum = await verifyEmailClassification(emailClassification);
    emailScore = `${emailNum}%`;
  }
  if (orderStatus == null) {
    log.warn(`Cannot find order status sheet`);
    orderScore = `Not provided`;
  } else {
    const orderNum = await verifyOrderStatus(orderStatus);
    orderScore = `${orderNum}%`;
  }

  return {
    classification: emailScore,
    orderStatus: orderScore,
  };
}

async function verifyEmailClassification(emailClassification: SheetData): Promise<number> {
  const correctMatches = new Set<string>();
  const emailClassificationRows = emailClassification.content?.slice(1);
  for (const row of emailClassificationRows) {
    const emailId = row[0];
    let category: string = row[1];
    category = category.replace(/enquiry/gi, 'inquiry'); // The most common spelling error :D

    const expected = EmailClassification.find((email) => email.emailId === emailId) ?? null;
    const expectedCatMatch = expected?.category === 'order request' ? ['req', 'order'] : ['inq'];

    const match = expectedCatMatch.find((it) => category.toLowerCase().includes(it)) != null;
    if (match) {
      correctMatches.add(emailId);
    } else {
      log.debug(`[Email Classification]      ${emailId} => ${category} (MISMATCH, expected ${expected?.category})`);
    }
  }
  const matchedCount = correctMatches.size;
  const percent = Math.round((matchedCount / EmailClassification.length) * 100);
  log.debug(`[Email Classification] ${matchedCount} / ${EmailClassification.length} (${percent}%)`);
  return percent;
}

async function verifyOrderStatus(orderStatus: SheetData): Promise<number> {
  const orderStatusRows = orderStatus?.content.slice(1);
  let matchedCount = 0;
  for (const row of orderStatusRows) {
    try {
      const emailId = row[0];
      const productId = row[1];
      const quantity = Number(row[2]);
      const status = row[3];

      const expected =
        ExpectedOrderData.find((order) => order.emailId === emailId && order.productId === productId) ?? null;
      if (expected == null) {
        log.debug(`[Order Status]      ${emailId} => ${productId} (${quantity}x) ${status} (NOT FOUND)`);
      } else {
        // Check the amount and status
        if (expected.quantity === quantity && expected.status === status.toLowerCase()) {
          matchedCount++;
        } else {
          log.debug(
            `[Order Status]      ${emailId} => ${productId} (${quantity}x) ${status} (MISMATCH, expected '${expected.quantity}' '${expected.status}')`,
          );
        }
      }
    } catch (e) {
      log.debug(`[Order Status]      Cannot parse row: ${row}`);
    }
  }
  const percent = Math.round((matchedCount / ExpectedOrderData.length) * 100);
  log.debug(`[Order Status] ${matchedCount} / ${orderStatusRows.length} (${percent}%)`);
  return percent;
}
