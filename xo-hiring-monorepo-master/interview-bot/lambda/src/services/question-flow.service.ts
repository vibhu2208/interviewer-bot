import { QuestionDocument } from '../model/question';
import { SessionDocument } from '../model/session';
import { InterviewQuestionFlowService } from './interview-question-flow.service';
import { PromptEngineeringQuestionFlowService } from './prompt-engineering-question-flow.service';

/**
 * Abstract service to handle the logic flow for processing an answer attempt
 * based on the question/skill type.
 */
export abstract class QuestionFlowService {
  /**
   * Processes the user's answer attempt based on the specific skill mode logic.
   * This typically involves validation, updating the database, and potentially triggering
   * asynchronous tasks (like SQS messages).
   *
   * @param answer The answer provided by the user.
   * @param question The full Question document.
   * @param session The full Session document.
   * @param currentAttempt The attempt number for this answer.
   */
  abstract processAnswerAttempt(
    answer: string,
    question: QuestionDocument,
    session: SessionDocument,
    currentAttempt: number,
  ): Promise<void>;
}
