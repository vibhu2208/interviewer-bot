import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import ObjectsToCsv from 'objects-to-csv';
import { Logger } from '../common/logger';
import { Config } from '../config';
import { Email } from '../integrations/email';
import { GradingBatchDocument } from '../model/grading-batch';
import { GradingTask } from '../model/grading-task';

const log = Logger.create('gen-dry-run-results');

export async function handleCompletedBatchResults(batch: GradingBatchDocument): Promise<void> {
  const logContext = log.context({
    batchId: batch.id,
    applicationStepId: batch.data.applicationStepId,
  });
  try {
    log.info(`Processing batch grading results`, logContext);

    const output: TaskResult[] = [];
    const errorTaskReports: string[] = [];

    const tasks = await GradingTask.getForBatch(batch.id);
    for (const task of tasks) {
      if (task.gradingError != null) {
        errorTaskReports.push(
          `Task '${task.id}' for ASR '${task.applicationStepResultId}' had grading error: ${task.gradingError}`,
        );
      }

      await GradingTask.fillFromPromptExecutionTasks(task);

      // Do not include problematic submissions yet
      if (task.grading == null) {
        continue;
      }
      for (let i = 0; i < task.grading.length; i++) {
        const grading = task.grading[i];
        const rule = task.rules[i];
        output.push({
          applicationStepId: task.applicationStepId,
          applicationStepResultId: task.applicationStepResultId,
          applicationName: task.data?.applicationName ?? '',
          submissionDate: task.data?.submissionTime ?? '',
          asrScore: task.data?.score ?? '',
          asrGrader: task.data?.grader ?? '',
          submissionLink: task.submissionLink ?? '',
          gradingRuleId: rule.id,
          gradingRuleName: rule.name,
          gradingRuleMode: rule.aiGradingMode ?? 'Calibration',
          gradingRuleScore: rule.score ?? '',
          gradingResult: grading.result,
          gradingConfidence: grading.confidence,
          gradingReasoning: grading.reasoning,
          candidateFeedback: grading.feedback,
        });
        log.info(
          `Grading rule[${rule.name}]: result=${grading.result}, confidence=${grading.confidence}, reasoning=${grading.reasoning}, feedback=${grading.feedback}`,
          log.context({
            ...task,
            ...logContext,
            taskId: task.id,
          }),
        );
      }
    }

    // Generate csv
    const csv = new ObjectsToCsv(output);
    const content = await csv.toString(true, true);

    // Store in the s3
    const filename = `${new Date().toISOString()}-${batch.data.applicationStepId}-${batch.data.recipientEmail}.csv`;
    const s3Client = new S3Client({ region: Config.getRegion() });
    log.info(
      `Storing results csv file to the ${Config.getBatchReportsBucketName()}/batch-reports/${filename}`,
      logContext,
    );
    await s3Client.send(
      new PutObjectCommand({
        Bucket: Config.getBatchReportsBucketName(),
        Key: `batch-reports/${filename}`,
        Body: content,
      }),
    );

    let gradingErrors = '';
    if (errorTaskReports.length > 0) {
      gradingErrors = '\n\nGrading Errors:\n' + errorTaskReports.join('\n');
    }

    // Send an email
    log.info(`Sending email with results to ${batch.data.recipientEmail}`, logContext);
    await Email.getTransporter().sendMail({
      from: 'noreply@crossover.com',
      to: batch.data.recipientEmail,
      subject: `[Grading Bot] Batch is graded: ${batch.id}`,
      text: batch.data.notes + gradingErrors,
      attachments: [
        {
          filename,
          content,
        },
      ],
    });
  } catch (e) {
    log.error(`Error while processing batch results`, e, logContext);
  }
}

interface TaskResult {
  applicationStepId: string;
  applicationStepResultId: string;
  applicationName: string;
  submissionDate: string;
  asrScore: string;
  asrGrader: string;
  submissionLink: string;
  gradingRuleId: string;
  gradingRuleName: string;
  gradingRuleMode: string;
  gradingRuleScore: string;
  gradingResult: string;
  gradingConfidence: number;
  gradingReasoning: string;
  candidateFeedback: string;
}
