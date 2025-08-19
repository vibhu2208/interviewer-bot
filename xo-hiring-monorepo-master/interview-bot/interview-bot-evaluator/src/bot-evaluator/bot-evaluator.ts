import { InterviewBotClient } from '../client/interview-bot-client';
import { OrderAssessmentRequest, OrderAssessmentResponse } from '../client/types';
import { Session, Question, SessionState } from '../client/graphql/api';
import { v4 as uuid } from 'uuid';
import personas from '../personas/persona';
import { Conversation } from './conversation';
import { GradingAccuracyEvaluation, GradingAccuracyJudge } from './grading-accuracy-judge';
import config from '../config';
import * as fs from 'fs';
import * as path from 'path';
import { Persona } from '../personas/types';
import { LucasPersona } from '../personas/lucas-persona';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class BotEvaluator {
  private readonly client: InterviewBotClient;
  private readonly gradingJudge: GradingAccuracyJudge;

  constructor(apiUrl: string, gqlApiUrl: string, gqlApiKey: string) {
    this.client = new InterviewBotClient(apiUrl, gqlApiUrl, gqlApiKey);
    this.gradingJudge = new GradingAccuracyJudge();
  }

  private async runEvaluationAttempt(skillId: string, persona: Persona): Promise<void> {
    const assessment = await this.createAssessment(skillId, persona);
    const session = await this.waitForSessionReady(assessment.assessment_id);
    await this.runWithTimeout(() => this.simulateInterviewSession(session, persona), 600000, 'Interview timed out');
    console.log(`Assessment result: ${assessment.assessment_result_url}`);
    const gradedSession = await this.getGradedSession(assessment);
    const evaluation = await this.retry(() => this.gradingJudge.evaluate(gradedSession), 2);
    const reportInput = { persona, assessment, session: gradedSession, evaluation };
    this.saveReport(reportInput);
  }

  public async start(skillId: string, persona: Persona) {
    console.log(`Starting bot evaluation for skill: ${skillId} with persona: ${persona.name}`);
    try {
      await this.retry(() => this.runEvaluationAttempt(skillId, persona), 2);
    } catch (error) {
      console.error(`All attempts failed for ${persona.name} with skill ${skillId}`);
      throw error;
    }
  }

  private async runWithTimeout(fn: () => Promise<void>, timeoutMs: number, errorMsg: string) {
    return Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), timeoutMs))]);
  }

  private async retry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
    let lastError: Error | null = null;
    for (let i = 0; i <= retries; i++) {
      try {
        if (i > 0) {
          console.log(`Retry attempt ${i}`);
        }
        return await fn();
      } catch (error) {
        lastError = error as Error;
        console.error(`Attempt ${i + 1} failed:`, lastError);
        if (i === retries) throw lastError;
      }
    }
    throw lastError!;
  }

  private async waitForSessionReady(assessmentId: string): Promise<Session> {
    return this.pollUntilSession(assessmentId, undefined, (s) => s.state === SessionState.Ready);
  }

  private async getGradedSession(assessment: OrderAssessmentResponse): Promise<Session> {
    const secretKey = this.getSecretKey(assessment);
    return this.pollUntilSession(
      assessment.assessment_id,
      secretKey,
      (s) => s.questions[0]?.correctnessGrading?.score !== undefined,
    );
  }

  private getSecretKey(assessment: OrderAssessmentResponse): string {
    const secretKey = new URLSearchParams(assessment.assessment_result_url).get('secretKey');
    if (!secretKey) {
      throw new Error('Secret key not found in assessment result URL.');
    }
    return secretKey;
  }

  private async createAssessment(skillId: string, persona: Persona) {
    const request: OrderAssessmentRequest = {
      test_id: skillId,
      order_id: `test-order-${uuid()}`,
      candidate: {
        first_name: persona.name,
        last_name: 'Candidate',
        email: `test-candidate-${uuid()}@example.com`,
        country: 'US',
        test_group: config.TEST_GROUP,
      },
    };

    const response = await this.client.orderAssessment(request);
    console.log('Successfully ordered assessment:', response);
    return response;
  }

  private async pollUntilSession(
    assessmentId: string,
    secretKey: string | undefined,
    isReady: (session: Session) => boolean,
  ): Promise<Session> {
    const maxRetries = 10;
    const retryInterval = 2000;

    console.log('Waiting for session to be ready...');
    for (let i = 0; i < maxRetries; i++) {
      const session = await this.client.getSession(assessmentId, secretKey);
      if (isReady(session)) {
        return session;
      }
      await sleep(retryInterval);
    }

    throw new Error('Session did not become ready in time.');
  }

  private async simulateInterviewSession(initialSession: Session, persona: Persona) {
    const initialQuestion = initialSession.questions?.filter((q): q is Question => !!q)[0];
    if (!initialQuestion) {
      throw new Error('Session has no initial question.');
    }

    const conversation = new Conversation(this.client, persona, initialSession.id, initialQuestion.id);

    await conversation.runConversation();
    await this.client.markSessionCompleted(initialSession.id);
  }

  public saveReport(reportInput: {
    persona: Persona;
    assessment: OrderAssessmentResponse;
    session: Session;
    evaluation: GradingAccuracyEvaluation;
  }) {
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir);
    }
    const filename = `report-${reportInput.persona.name.replace(/ /g, '_')}-${
      reportInput.session.skill.id
    }-${new Date().toISOString()}.json`;
    const filepath = path.join(reportsDir, filename);
    fs.writeFileSync(filepath.replace('.md', '.json'), JSON.stringify(reportInput, null, 2));
    console.log(`\nEvaluation report saved to: ${filepath}`);
  }
}

/**
 * Self-invoking main function to run the bot evaluation.
 */
(async () => {
  if (require.main === module) {
    const evaluator = new BotEvaluator(
      config.INTERVIEW_BOT_API_URL,
      config.INTERVIEW_BOT_GQL_API_URL,
      config.INTERVIEW_BOT_GQL_API_KEY,
    );
    const skips: [string, string][] = [];

    // Collect all evaluation tasks
    const evaluationTasks: Array<{ skillId: string; persona: Persona }> = [];
    for (const skillId of config.TEST_SKILL_IDS) {
      for (const persona of [...personas, new LucasPersona()]) {
        if (skips.some(([personaName, skillId]) => personaName === persona.name && skillId === skillId)) {
          console.log(`Skipping ${persona.name} for skill ${skillId}`);
          continue;
        }
        // Run 2 evaluations for each persona
        evaluationTasks.push({ skillId, persona });
        evaluationTasks.push({ skillId, persona });
      }
    }

    const batchSize = 6;
    for (let i = 0; i < evaluationTasks.length; i += batchSize) {
      const batch = evaluationTasks.slice(i, i + batchSize);
      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(evaluationTasks.length / batchSize)} (${
          batch.length
        } evaluations)`,
      );

      const batchPromises = batch.map(({ skillId, persona }) =>
        evaluator.start(skillId, persona).catch((error) => {
          console.error(`Failed evaluation for ${persona.name} with skill ${skillId}:`, error);
          return error; // Return error instead of throwing to not break Promise.all
        }),
      );

      await Promise.all(batchPromises);
      console.log(`Completed batch ${Math.floor(i / batchSize) + 1}`);
    }

    console.log('All evaluations complete.');
  }
})();
