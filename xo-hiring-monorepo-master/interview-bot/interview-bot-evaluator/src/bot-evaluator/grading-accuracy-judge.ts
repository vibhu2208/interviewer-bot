import { generateObject } from 'ai';
import { Llm } from '@trilogy-group/xoh-integration';
import { z } from 'zod';
import { Session } from '../client/graphql/api';
import config from '../config';

const JUDGE_SYSTEM_PROMPT = `
You are an expert evaluator for AI-based job interviews. Your task is to assess the quality of an interview conducted by an AI interviewer based on a provided transcript, and the final grading provided by the interviewer.

You must evaluate the interview against the following criteria. For each point, provide a 'Pass' or 'Fail' status, a brief reasoning, and optional, short evidence from the transcript.

**Evaluation Rubric:**

- **[Interview Execution] Conversational Flow**: Did the interview feel like a natural conversation? Did the bot maintain a professional tone?
- **[Interview Execution] Requirement Validation**: Did the bot ask relevant questions to validate the candidate's claims? Did it ask meaningful follow-up questions?
- **[Interview Execution] Evidence Gathering**: Did the bot capture specific examples and evidence to support the candidate's claims?
- **[Interview Execution] Clarity**: Did the bot ask one clear question at a time?

- **[Credibility Checking] Claim Verification**: Did the bot attempt to verify the candidate's claims?
- **[Credibility Checking] Inconsistency Detection**: Did the bot identify and probe inconsistencies or questionable statements?
- **[Credibility Checking] Probing for Detail**: Did the bot ask for specific details when claims were vague?

- **[Profile Development] Depth of Experience**: Did the bot's questions help to extract the depth of the candidate's experience?
- **[Profile Development] Motivation and Fit**: Did the bot explore the candidate's motivations and fit for a role?
- **[Profile Development] Comprehensive Skill Assessment**: Did the bot's questioning build a comprehensive view of the candidate's skills?

- **[Compliance Constraints] No AI Reference**: The bot must **not** reference being an AI or a simulation.
- **[Compliance Constraints] One Question at a Time**: The bot must ask one question at a time.
- **[Compliance Constraints] Consistent Persona**: The bot must maintain a consistent, professional interviewer persona.
`;

const EvaluationCheckSchema = z.object({
  name: z.string().describe('The name of the check.'),
  status: z.enum(['Pass', 'Fail', 'Not Applicable']),
  reasoning: z.string().describe('Brief explanation for the Pass/Fail/Not Applicable status.'),
  evidence: z.string().optional().describe('A short quote from the transcript as evidence.'),
});

export const GradingAccuracyEvaluationSchema = z.object({
  summary: z.string().describe('A brief, one-paragraph summary of the overall evaluation.'),
  gradingSummaryEvaluation: z.string().describe('A brief, one-paragraph evaluation of the grading summary.'),
  checks: z.array(EvaluationCheckSchema),
});

export type GradingAccuracyEvaluation = z.infer<typeof GradingAccuracyEvaluationSchema>;

/**
 * Evaluates the grading accuracy and overall quality of an interview session.
 */
export class GradingAccuracyJudge {
  /**
   * Evaluates the full interview session against the grading rubric.
   * @param session The completed and graded interview session.
   * @returns The evaluation score and reasoning.
   */
  async evaluate(session: Session): Promise<GradingAccuracyEvaluation> {
    console.log('Evaluating...');
    const evaluationPrompt = this.createEvaluationPrompt(session);
    const model = await Llm.getModel(config.LLM_DEFINITION);

    const { object: evaluation } = await generateObject({
      model,
      system: JUDGE_SYSTEM_PROMPT,
      schema: GradingAccuracyEvaluationSchema,
      prompt: evaluationPrompt,
    });

    return evaluation;
  }

  private createEvaluationPrompt(session: Session): string {
    const transcript = this.formatTranscript(session);
    const gradingSummary = this.formatGradingSummary(session);

    return `
Based on the following interview transcript and the interviewer's final summary, provide a final evaluation as a structured JSON object.


**Interview Transcript:**
---
${transcript}
---

**Interviewer's Final Grade & Summary:**
---
${gradingSummary}
---

Provide your final evaluation as a JSON object that adheres to the provided schema.
    `;
  }

  private formatTranscript(session: Session): string {
    return (
      session.questions[0]?.conversation
        ?.filter((c) => c?.role && c?.content)
        .map((c) => {
          if (c?.role === 'user') {
            return `Candidate: ${c?.content}\n`;
          } else if (c?.role === 'assistant') {
            return `Interviewer: ${c?.content}\n`;
          }
          throw new Error(`Unknown role: ${c?.role}`);
        })
        .join('\n\n') || 'No transcript available.'
    );
  }

  private formatGradingSummary(session: Session): string {
    const correctnessGrading = session.questions[0]?.correctnessGrading;
    if (!correctnessGrading) {
      return 'No grading information available.';
    }

    return `Grading Score: ${correctnessGrading?.score?.toFixed(2)}\n\nGrading Summary:\n - ${
      correctnessGrading?.summary
    }`;
  }
}
