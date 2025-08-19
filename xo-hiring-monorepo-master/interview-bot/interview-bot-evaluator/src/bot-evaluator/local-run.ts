import { ConversationElement, QuestionDocument } from '../../../lambda/src/model/question';
import { MatchingInterviewService } from '../../../lambda/src/services/matching-interview.service';
import personas, { Persona } from '../personas/persona';
import { SessionDocument } from '../../../lambda/src/model/session';
import { GradingAccuracyEvaluation, GradingAccuracyJudge } from './grading-accuracy-judge';
import { Session } from '../client/graphql/api';
import { Config } from '../../../lambda/src/config';
import { AnswerAttemptResult } from '../../../lambda/src/integrations/appsync';
import { OrderAssessmentResponse } from '../client/types';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Testable version of MatchingInterviewService that overrides external dependencies
 */
class TestableMatchingInterviewService extends MatchingInterviewService {
  protected async updateConversation(sessionId: string, questionId: string, conversation: any[]): Promise<void> {
    // Mock - no actual database update
  }

  protected async notifyAnswerAttempted(answerAttemptResult: AnswerAttemptResult): Promise<void> {
    // Mock - no actual AppSync notification
  }

  protected async saveQuestion(question: QuestionDocument): Promise<void> {
    // Mock - no actual database update
    console.log('Mock saveQuestion', JSON.stringify(question.correctnessGrading, null, 2));
  }
}

/**
 * Create mock data for testing with personas
 */
function createMockData(personaName?: string) {
  // Mock QuestionDocument with empty conversation (will be built during chat)
  const mockQuestion = {
    id: 'mock-question-id',
    conversation: [] as ConversationElement[],
    dimensions: [],
  };

  // Mock SessionDocument
  const mockSession = {
    id: 'mock-session-id',
    candidateId: 'mock-candidate-id',
    skillId: '21600000-0000-0000-0000-000000000000', // Our target skill
    firstName: 'John',
    lastName: 'Doe',
    skillName: 'Serverless Web Application Development',
  };

  return { mockQuestion, mockSession };
}

/**
 * Convert our local conversation to the Session format expected by the judge
 */
function createMockSessionForJudge(question: QuestionDocument): Session {
  return {
    id: 'mock-session-id',
    skill: {
      id: '21600000-0000-0000-0000-000000000000',
    },
    testTaker: {
      name: 'John Doe',
    },
    questions: [
      {
        id: 'mock-question-id',
        conversation: question.conversation,
        correctnessGrading: question.correctnessGrading,
      },
    ],
  } as Session;
}

/**
 * Run a multi-turn conversation between a persona and the matching interview service
 */
async function runConversationTest(persona: Persona, numRounds: number = 3): Promise<QuestionDocument> {
  console.log(`Testing with persona: ${persona.name} (${persona.priority} priority)`);
  console.log(`Behavior: ${persona.behavior.goal}`);
  console.log(`Risk: ${persona.behavior.risk}\n`);

  const { mockQuestion, mockSession } = createMockData();
  const service = new TestableMatchingInterviewService();

  // User always starts the conversation with "Hi"
  mockQuestion.conversation.push({
    role: 'user',
    content: 'Hi',
  });

  for (let round = 1; round <= numRounds; round++) {
    try {
      // Generate interviewer response
      await service.generateAssistantResponse(
        mockQuestion as unknown as QuestionDocument,
        mockSession as unknown as SessionDocument,
      );

      const lastResponse = mockQuestion.conversation[mockQuestion.conversation.length - 1];

      console.log(`[${round}/${numRounds}][Interviewer]:\t${lastResponse.content.substring(0, 100)}...\n`);
      if (lastResponse.content.includes('[**END_OF_INTERVIEW**]')) {
        break;
      }

      // Persona responds to interviewer
      const personaResponse = await persona.chat(lastResponse.content);
      console.log(`[${round}/${numRounds}][${persona.name}]:\t${personaResponse.substring(0, 100)}...\n`);

      // Add persona response to conversation
      mockQuestion.conversation.push({
        role: 'user',
        content: personaResponse,
      });
    } catch (error) {
      console.error(`Error in round ${round}:`, error);
      break;
    }
  }
  return mockQuestion as unknown as QuestionDocument;
}

/**
 * Main test function
 */
async function runTest() {
  console.log('Starting MatchingInterviewService persona integration test...\n');
  console.log(`Model: ${Config.getMatchingInterviewLlmModel().model}`);
  console.log();

  const targetPersonas = [...personas, ...personas].filter((p) => ['IDEAL_CANDIDATE'].includes(p.name));

  const concurrentTests = 3;
  const totalBatches = Math.ceil(targetPersonas.length / concurrentTests);

  for (let i = 0; i < targetPersonas.length; i += concurrentTests) {
    const currentBatch = Math.floor(i / concurrentTests) + 1;
    const batchPersonas = targetPersonas.slice(i, i + concurrentTests);

    console.log(`Running batch ${currentBatch}/${totalBatches} (${batchPersonas.length} tests)`);
    console.log(`Personas: ${batchPersonas.map((p) => p.name).join(', ')}`);

    const batchPromises = batchPersonas.map((persona) => runTestForPersona(persona));

    try {
      await Promise.all(batchPromises);
      console.log(`Batch ${currentBatch} complete`);
    } catch (error) {
      console.error(`Batch ${currentBatch} had failures:`, error);
      // Continue with next batch even if this one fails
    }

    // Brief pause between batches to avoid overwhelming the system
    if (currentBatch < totalBatches) {
      console.log('Pausing briefly between batches...');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function runTestForPersona(persona: Persona) {
  try {
    // Run conversation test
    const question = await runConversationTest(persona, 30);

    console.log('\nFinal Transcript:');
    const transcript = question
      .conversation!.map((msg, index) => {
        const speaker = msg.role === 'user' ? 'Candidate' : 'Interviewer';
        return `[${speaker}]: ${msg.content.replace(/^"|"$/g, '').replace(/\n\n/g, '\n')}`;
      })
      .join('\n');
    console.log(transcript);

    // Evaluate the conversation
    const mockSession = createMockSessionForJudge(question);
    const judge = new GradingAccuracyJudge();
    const evaluation = await judge.evaluate(mockSession);

    saveReport({
      persona,
      assessment: {
        assessment_id: 'mock-assessment-id',
        assessment_url: 'mock-assessment-url',
        assessment_result_url: 'mock-assessment-result-url',
      },
      session: mockSession,
      evaluation,
    });
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

function saveReport(reportInput: {
  persona: Persona;
  assessment: OrderAssessmentResponse;
  session: Session;
  evaluation: GradingAccuracyEvaluation;
}) {
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir);
  }
  const filename = `report-${reportInput.persona.priority}-${reportInput.persona.name.replace(/ /g, '_')}-${
    reportInput.session.skill.id
  }-${new Date().toISOString()}.json`;
  const filepath = path.join(reportsDir, filename);
  fs.writeFileSync(filepath.replace('.md', '.json'), JSON.stringify(reportInput, null, 2));
  console.log(`\nEvaluation report saved to: ${filepath}`);
}

// Run the test if this file is executed directly
if (require.main === module) {
  runTest();
}
