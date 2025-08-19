import { Config } from '../../../src/config';
import { ExperimentGroup } from '../../../src/model/session';
import { ABTestingService } from '../../../src/services/ab-testing.service';

// Mock the Config module
jest.mock('../../../src/config');
const mockConfig = Config as jest.Mocked<typeof Config>;

describe('ABTestingService', () => {
  const pilotSkillId1 = '19100000-0000-0000-0000-000000000000';
  const pilotSkillId2 = '89000000-0000-0000-0000-000000000000';
  const nonPilotSkillId = 'non-pilot-skill-id';

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock the pilot skill IDs
    mockConfig.getMatchingInterviewPilotSkillIds.mockReturnValue(new Set([pilotSkillId1, pilotSkillId2]));
    mockConfig.getEnv.mockReturnValue('sandbox');
  });

  describe('determineExperimentGroup', () => {
    describe('when no test group is provided', () => {
      it('should return Group1 for undefined test group', () => {
        const result = ABTestingService.determineExperimentGroup(undefined);

        expect(result).toBe(ExperimentGroup.Group1);
      });
    });

    describe('test group mapping', () => {
      it('should map test groups 0-2 to Group1', () => {
        expect(ABTestingService.determineExperimentGroup('0')).toBe(ExperimentGroup.Group1);
        expect(ABTestingService.determineExperimentGroup('1')).toBe(ExperimentGroup.Group1);
        expect(ABTestingService.determineExperimentGroup('2')).toBe(ExperimentGroup.Group1);
      });

      it('should map test groups 3-5 to Group2', () => {
        expect(ABTestingService.determineExperimentGroup('3')).toBe(ExperimentGroup.Group2);
        expect(ABTestingService.determineExperimentGroup('4')).toBe(ExperimentGroup.Group2);
        expect(ABTestingService.determineExperimentGroup('5')).toBe(ExperimentGroup.Group2);
      });

      it('should map test groups 6-8 to Group3', () => {
        expect(ABTestingService.determineExperimentGroup('6')).toBe(ExperimentGroup.Group3);
        expect(ABTestingService.determineExperimentGroup('7')).toBe(ExperimentGroup.Group3);
        expect(ABTestingService.determineExperimentGroup('8')).toBe(ExperimentGroup.Group3);
      });

      it('should map test groups 9-11 to Group4', () => {
        expect(ABTestingService.determineExperimentGroup('9')).toBe(ExperimentGroup.Group4);
        expect(ABTestingService.determineExperimentGroup('10')).toBe(ExperimentGroup.Group4);
        expect(ABTestingService.determineExperimentGroup('11')).toBe(ExperimentGroup.Group4);
      });
    });
  });

  describe('shouldUseMatchingInterview', () => {
    describe('when no experiment group is provided', () => {
      it('should return false for undefined experiment group', () => {
        const result = ABTestingService.shouldUseMatchingInterview(undefined, pilotSkillId1);

        expect(result).toBe(false);
      });
    });

    it('should return true for Group2 with pilot skill', () => {
      const result = ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group2, pilotSkillId1);

      expect(result).toBe(true);
      expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
    });

    it('should return true for Group3 with pilot skill', () => {
      const result = ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group3, pilotSkillId1);

      expect(result).toBe(true);
      expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
    });

    it('should return true for Group2 with second pilot skill', () => {
      const result = ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group2, pilotSkillId2);

      expect(result).toBe(true);
      expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
    });

    it('should return false for Group1 with pilot skill', () => {
      const result = ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group1, pilotSkillId1);

      expect(result).toBe(false);
      expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
    });

    it('should return false for Group4 with pilot skill', () => {
      const result = ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group4, pilotSkillId1);

      expect(result).toBe(false);
      expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
    });

    it('should return false for Group2 with non-pilot skill', () => {
      const result = ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group2, nonPilotSkillId);

      expect(result).toBe(false);
      expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
    });

    it('should return false when skill ID is undefined', () => {
      const result = ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group2, undefined as any);

      expect(result).toBe(false);
      expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
    });

    it('should return false when skill ID is empty string', () => {
      const result = ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group2, '');

      expect(result).toBe(false);
      expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
    });

    describe('edge cases', () => {
      it('should handle empty pilot skills set', () => {
        mockConfig.getMatchingInterviewPilotSkillIds.mockReturnValue(new Set());

        const result = ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group2, pilotSkillId1);

        expect(result).toBe(false);
        expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
      });
    });

    describe('config integration', () => {
      it('should call config methods when checking pilot skills', () => {
        ABTestingService.shouldUseMatchingInterview(ExperimentGroup.Group2, pilotSkillId1);

        expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledTimes(1);
        expect(mockConfig.getMatchingInterviewPilotSkillIds).toHaveBeenCalledWith();
      });

      it('should not call config methods when no experiment group provided', () => {
        ABTestingService.shouldUseMatchingInterview(undefined, pilotSkillId1);

        expect(mockConfig.getMatchingInterviewPilotSkillIds).not.toHaveBeenCalled();
        expect(mockConfig.getEnv).not.toHaveBeenCalled();
      });
    });
  });
});
