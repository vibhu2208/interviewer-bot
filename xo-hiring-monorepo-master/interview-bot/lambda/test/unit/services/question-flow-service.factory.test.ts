import { createQuestionFlowService } from '../../../src/services/question-flow-service.factory';
import { InterviewQuestionFlowService } from '../../../src/services/interview-question-flow.service';
import { MatchingInterviewService } from '../../../src/services/matching-interview.service';
import { PromptEngineeringQuestionFlowService } from '../../../src/services/prompt-engineering-question-flow.service';
import { SkillDocument } from '../../../src/model/skill';
import { SessionDocument, ExperimentGroup } from '../../../src/model/session';
import { ABTestingService } from '../../../src/services/ab-testing.service';

// Mocks
jest.mock('../../../src/services/interview-question-flow.service');
jest.mock('../../../src/services/matching-interview.service');
jest.mock('../../../src/services/prompt-engineering-question-flow.service');
jest.mock('../../../src/services/ab-testing.service');

const mockedInterviewQuestionFlowService = InterviewQuestionFlowService as jest.MockedClass<
  typeof InterviewQuestionFlowService
>;
const mockedMatchingInterviewService = MatchingInterviewService as jest.MockedClass<typeof MatchingInterviewService>;
const mockedPromptEngineeringQuestionFlowService = PromptEngineeringQuestionFlowService as jest.MockedClass<
  typeof PromptEngineeringQuestionFlowService
>;
const mockedABTestingService = ABTestingService as jest.MockedClass<typeof ABTestingService>;

describe('createQuestionFlowService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return PromptEngineeringQuestionFlowService for prompt-engineering mode', () => {
    const skill: Partial<SkillDocument> = {
      id: 'test-skill-id',
      mode: 'prompt-engineering',
    };
    const session: Partial<SessionDocument> = {
      id: 'session-id',
      experiment_group: ExperimentGroup.Group1,
    };

    const result = createQuestionFlowService(skill as SkillDocument, session as SessionDocument);

    expect(mockedPromptEngineeringQuestionFlowService).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(PromptEngineeringQuestionFlowService);
  });

  describe('interview mode', () => {
    describe('with A/B test experiment groups', () => {
      it('should return MatchingInterviewService when shouldUseMatchingInterview returns true', () => {
        (mockedABTestingService.shouldUseMatchingInterview as jest.Mock).mockReturnValue(true);

        const skill: Partial<SkillDocument> = {
          id: 'pilot-skill-id',
          mode: 'interview',
        };
        const session: Partial<SessionDocument> = {
          id: 'session-id',
          experiment_group: ExperimentGroup.Group2,
        };

        const result = createQuestionFlowService(skill as SkillDocument, session as SessionDocument);

        expect(mockedABTestingService.shouldUseMatchingInterview).toHaveBeenCalledWith(
          ExperimentGroup.Group2,
          'pilot-skill-id',
        );
        expect(mockedMatchingInterviewService).toHaveBeenCalledTimes(1);
        expect(result).toBeInstanceOf(MatchingInterviewService);
      });

      it('should return InterviewQuestionFlowService when shouldUseMatchingInterview returns false', () => {
        (mockedABTestingService.shouldUseMatchingInterview as jest.Mock).mockReturnValue(false);

        const skill: Partial<SkillDocument> = {
          id: 'non-pilot-skill-id',
          mode: 'interview',
        };
        const session: Partial<SessionDocument> = {
          id: 'session-id',
          experiment_group: ExperimentGroup.Group1,
        };

        const result = createQuestionFlowService(skill as SkillDocument, session as SessionDocument);

        expect(mockedABTestingService.shouldUseMatchingInterview).toHaveBeenCalledWith(
          ExperimentGroup.Group1,
          'non-pilot-skill-id',
        );
        expect(mockedInterviewQuestionFlowService).toHaveBeenCalledTimes(1);
        expect(result).toBeInstanceOf(InterviewQuestionFlowService);
      });
    });
  });

  it('should throw error for unsupported skill mode', () => {
    const skill: Partial<SkillDocument> = {
      id: 'test-skill-id',
      mode: 'unsupported-mode' as any,
    };
    const session: Partial<SessionDocument> = {
      id: 'session-id',
      experiment_group: ExperimentGroup.Group1,
    };

    expect(() => createQuestionFlowService(skill as SkillDocument, session as SessionDocument)).toThrow(
      'Unsupported skill mode: unsupported-mode',
    );
  });

  it('should log error message when unsupported mode is encountered', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const skill: Partial<SkillDocument> = {
      id: 'test-skill-id',
      mode: 'invalid-mode' as any,
    };
    const session: Partial<SessionDocument> = {
      id: 'session-id',
      experiment_group: ExperimentGroup.Group1,
    };

    expect(() => createQuestionFlowService(skill as SkillDocument, session as SessionDocument)).toThrow();
    expect(consoleSpy).toHaveBeenCalledWith('Unsupported skill mode encountered: invalid-mode');

    consoleSpy.mockRestore();
  });
});
