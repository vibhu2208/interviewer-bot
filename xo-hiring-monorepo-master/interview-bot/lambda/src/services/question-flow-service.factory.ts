import { SessionDocument } from '../model/session';
import { SkillDocument } from '../model/skill';
import { ABTestingService } from './ab-testing.service';
import { InterviewQuestionFlowService } from './interview-question-flow.service';
import { MatchingInterviewService } from './matching-interview.service';
import { PromptEngineeringQuestionFlowService } from './prompt-engineering-question-flow.service';
import { QuestionFlowService } from './question-flow.service';

/**
 * Factory function to create the appropriate QuestionFlowService instance based on skill mode and session experiment group.
 *
 * @param skill The Skill document.
 * @param session Session document containing A/B test experiment group information.
 * @returns An instance of QuestionFlowService.
 * @throws Error if the skill mode is unsupported.
 */
export function createQuestionFlowService(skill: SkillDocument, session: SessionDocument): QuestionFlowService {
  switch (skill.mode) {
    case 'prompt-engineering':
      return new PromptEngineeringQuestionFlowService();
    case 'interview':
      if (ABTestingService.shouldUseMatchingInterview(session.experiment_group, skill.id)) {
        return new MatchingInterviewService();
      }
      return new InterviewQuestionFlowService();
    default:
      console.error(`Unsupported skill mode encountered: ${skill.mode}`);
      throw new Error(`Unsupported skill mode: ${skill.mode}`);
  }
}
