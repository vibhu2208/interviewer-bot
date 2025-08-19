import Personas, { PredefinedPersona } from './persona';
import { PersonaAdherenceJudge } from './persona-adherence-judge';

async function evaluatePersona(persona: PredefinedPersona): Promise<void> {
  console.log(`\n\n=========================================`);
  console.log(`Evaluating persona: ${persona.name}...`);
  console.log(`Persona prompt: ${persona.prompt}`);
  console.log(`=========================================`);

  try {
    const judge = new PersonaAdherenceJudge();
    const evaluation = await judge.interviewAndJudge(persona);

    console.log('\n--- Final Evaluation Result ---');
    console.log(JSON.stringify(evaluation, null, 2));
  } catch (error) {
    console.error(`\nAn error occurred during validation for ${persona.name}:`, error);
    // Continue to the next persona even if one fails
  }
}

/**
 * Self-invoking main function to run the persona validation when the script is executed directly.
 */
(async () => {
  if (require.main === module) {
    try {
      for (const persona of Personas) {
        await evaluatePersona(persona);
      }
    } catch (error) {
      console.error('\nAn unexpected error occurred during the evaluation run:', error);
      process.exit(1);
    }
  }
})();
