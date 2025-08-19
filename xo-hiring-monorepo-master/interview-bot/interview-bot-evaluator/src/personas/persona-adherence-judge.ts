import { CoreMessage, generateObject } from 'ai';
import { Llm } from '@trilogy-group/xoh-integration';
import { z } from 'zod';
import config from '../config';
import { PredefinedPersona } from './persona';

const JUDGE_SYSTEM_PROMPT = `
You are an expert interviewer and evaluator. Your goal is to test if a candidate demonstrates their expected behavior pattern.

You will conduct a brief, multi-turn interview. In each turn, you will:
1. Ask a question designed to elicit the expected behavior pattern.
2. Receive the candidate's answer.
3. Decide if you have enough evidence of the behavior pattern. If not, ask a follow-up question that probes deeper.

If you don't have enough evidence, you will ask another follow-up question.
If you DO have enough evidence, you will stop the interview and provide your final evaluation.
`;

const InterviewActionSchema = z.object({
  action: z.enum(['ASK_QUESTION', 'EVALUATE']),
  confidence: z.number().min(0).max(1).describe('Confidence in detecting the behavior pattern (0.0 to 1.0)'),
  question: z
    .string()
    .optional()
    .describe("The next question to ask the candidate. Required if action is 'ASK_QUESTION'."),
});

export const BehaviorEvaluationSchema = z.object({
  behaviorDemonstrated: z.boolean().describe('Whether the candidate demonstrated the expected behavior pattern'),
  confidence: z.number().min(0).max(1).describe('Confidence in the behavior assessment (0.0 to 1.0)'),
  evidence: z.array(z.string()).describe('Specific examples of the behavior pattern'),
});

export type BehaviorEvaluation = z.infer<typeof BehaviorEvaluationSchema>;

/**
 * Evaluates if a persona successfully demonstrates its expected behavior pattern.
 */
export class PersonaAdherenceJudge {
  private readonly MAX_TURNS = 10;

  /**
   * Conducts a multi-turn interview with a persona and evaluates if it demonstrates its expected behavior.
   * @param persona The Persona instance to interview.
   * @returns The behavior evaluation results.
   */
  async interviewAndJudge(persona: PredefinedPersona): Promise<BehaviorEvaluation> {
    const conversation: CoreMessage[] = [];

    for (let i = 0; i < this.MAX_TURNS; i++) {
      const interviewerPrompt = this.createInterviewerPrompt(persona, conversation);
      const model = await Llm.getModel(config.LLM_DEFINITION);

      console.log(`\n--- Interview Turn ${i + 1} ---`);

      const { object: interviewAction } = await generateObject({
        model,
        system: JUDGE_SYSTEM_PROMPT,
        schema: InterviewActionSchema,
        prompt: interviewerPrompt,
      });

      if (interviewAction.action === 'ASK_QUESTION' && interviewAction.question) {
        console.log(`Interviewer: ${interviewAction.question}`);
        const candidateResponse = await persona.chat(interviewAction.question);
        console.log(`Candidate: ${candidateResponse}`);
        conversation.push({ role: 'user', content: interviewAction.question });
        conversation.push({ role: 'assistant', content: candidateResponse });
      } else {
        console.log('--- Interview Concluded: LLM decided to evaluate ---');
        break;
      }
    }

    return this.evaluate(persona, conversation);
  }

  /**
   * Evaluates the conversation for behavior pattern demonstration.
   * @param persona The persona being evaluated.
   * @param conversation The conversation transcript.
   * @returns The behavior evaluation results.
   */
  private async evaluate(persona: PredefinedPersona, conversation: CoreMessage[]): Promise<BehaviorEvaluation> {
    const evaluationPrompt = this.createEvaluationPrompt(persona, conversation);
    const model = await Llm.getModel(config.LLM_DEFINITION);

    const { object: evaluation } = await generateObject({
      model,
      schema: BehaviorEvaluationSchema,
      prompt: evaluationPrompt,
    });

    return evaluation;
  }

  private createInterviewerPrompt(persona: PredefinedPersona, conversation: CoreMessage[]): string {
    const transcript = conversation.map((msg) => `${msg.role}: ${msg.content}`).join('\n');
    return `
You are an expert interviewer testing if a candidate demonstrates their expected behavior pattern.

Persona Details:
- Name: ${persona.name}
- Goal: ${persona.behavior.goal}
- Expected Behavior: ${persona.behavior.behavior.join(', ')}

The conversation so far:
---
${transcript || 'No conversation yet.'}
---

Based on the conversation, decide your next action. Either ask another probing question to test for the behavior pattern, or end the interview and provide your final evaluation.
Your first question should be a general opening, like "Tell me about yourself."
    `;
  }

  private createEvaluationPrompt(persona: PredefinedPersona, conversation: CoreMessage[]): string {
    const transcript = conversation
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join('\n');

    return `
You are an expert evaluator analyzing if a candidate demonstrates their expected behavior pattern.

Persona Details:
- Name: ${persona.name}
- Goal: ${persona.behavior.goal}
- Expected Behavior: ${persona.behavior.behavior.join(', ')}

Conversation Transcript:
---
${transcript}
---

Evaluation Requirements:
1. Determine if the candidate demonstrates the expected behavior pattern
2. Provide specific examples from the transcript

Provide your evaluation as a JSON object.
    `;
  }
}
