import { CoreMessage, generateText } from 'ai';
import { Llm } from '@trilogy-group/xoh-integration';
import config from '../config';
import fs from 'fs';
import path from 'path';
import { Persona } from './types';

/**
 * Represents the LucasP candidate persona based on his background and interview content.
 */
export class LucasPersona implements Persona {
  public readonly name: string = 'LucasP';
  public readonly conversation: CoreMessage[] = [];
  public readonly prompt: string;

  constructor() {
    // Load the Lucas prompt from the text file
    this.prompt = this.loadLucasPrompt();
    this.conversation.push({ role: 'system', content: this.prompt });
  }

  private loadLucasPrompt(): string {
    try {
      const promptPath = path.join(__dirname, 'prompts', 'lucas.txt');
      const promptContent = fs.readFileSync(promptPath, 'utf-8');

      // Add additional instructions for interview behavior
      const behaviorInstructions = `

# Interview Behavior Guidelines
- **NEVER** use markdown formatting in your responses.
- **NEVER** use any special characters or formatting in your responses.
- **ALWAYS** keep answers concise and realistic — mirror how a thoughtful, professional human would answer under time pressure in a real interview.
- **ALWAYS** focus on **one or two key examples or outcomes** per answer. Avoid exhaustive lists or over-detailed project descriptions.
- **NEVER** use "résumé dumps" or excessive self-praise. Speak humbly and with focus on relevance.
- **NEVER** use corporate jargon or storytelling flourishes.
- **ALWAYS** assume the interviewer may ask for details later — don't frontload your entire career in one response.
- Your response MUST be less than 1000 characters.
- Dialogue Only. Your response must only contain your spoken words. Do not include any stage directions, physical actions, or non-verbal cues.
- End the conversation appropriately when:
  * The interviewer has clearly finished their questions
  * The conversation has reached a natural conclusion
  * You've exchanged more than 2 rounds of thank yous
- Do not artificially extend the conversation with unnecessary pleasantries
- Stay in character at all times. You are Lucas Pereira, a human candidate, not an AI or language model
- Draw from the specific experiences, examples, and knowledge provided in your background
- Use the conversational style and language patterns shown in the interview transcript
- Reference specific companies, projects, and outcomes from your work history when relevant
- Maintain the humble, direct communication style demonstrated in the interview`;

      return promptContent + behaviorInstructions;
    } catch (error) {
      console.error('Error loading Lucas prompt:', error);
      throw new Error('Failed to load Lucas persona prompt');
    }
  }

  /**
   * Appends a message from the bot and gets Lucas's response.
   * @param botMessage The message from the Interview Bot (the "assistant").
   * @returns Lucas's generated response (as the "user").
   */
  async chat(botMessage: string): Promise<string> {
    this.conversation.push({ role: 'user', content: botMessage });

    const model = await Llm.getModel(config.LLM_DEFINITION);
    const { text: lucasResponse } = await generateText({
      model,
      messages: this.conversation,
    });

    this.conversation.push({ role: 'assistant', content: lucasResponse });
    return lucasResponse;
  }

  /**
   * Gets the current conversation history
   */
  getConversation(): CoreMessage[] {
    return [...this.conversation];
  }

  /**
   * Resets the conversation to just the system prompt
   */
  resetConversation(): void {
    this.conversation.length = 0;
    this.conversation.push({ role: 'system', content: this.prompt });
  }
}
