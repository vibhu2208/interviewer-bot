import { Logger } from '../common/logger';
import { Config } from '../config';
import { ExperimentGroup } from '../model/session';

const log = Logger.create('ABTestingService');

export class ABTestingService {
  /**
   * Determines the A/B test experiment group based on candidate test group number
   * Maps test group numbers from Salesforce to meaningful experiment group names
   *
   * @param testGroup - Test group from Salesforce ('0' to '11')
   * @param skillId - Skill ID to check if eligible for matching interview pilot
   * @returns The experiment group to use for this session
   */
  static determineExperimentGroup(
    testGroup?: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11',
  ): ExperimentGroup {
    const logContext = { testGroup };

    if (!testGroup) {
      log.info('No test group is provided: Defaulting to control group1', logContext);
      return ExperimentGroup.Group1;
    }

    const experimentGroup = this.getExperimentGroup(testGroup);
    log.info('Experiment group assignment', logContext, { experimentGroup });
    return experimentGroup;
  }

  /**
   * Maps test group numbers to experiment groups
   *
   * Test group mapping:
   * - Groups 0-2: Group1
   * - Groups 3-5: Group2
   * - Groups 6-8: Group3
   * - Groups 9-11: Group4
   *
   * @param testGroup - The test group number as a string ('0' to '11')
   * @returns The corresponding experiment group for the given test group
   */
  private static getExperimentGroup(testGroup: string): ExperimentGroup {
    const experimentGroup = Number(testGroup);
    if (experimentGroup <= 2) {
      return ExperimentGroup.Group1;
    } else if (experimentGroup <= 5) {
      return ExperimentGroup.Group2;
    } else if (experimentGroup <= 8) {
      return ExperimentGroup.Group3;
    } else {
      return ExperimentGroup.Group4;
    }
  }

  static shouldUseMatchingInterview(experimentGroup: ExperimentGroup | undefined, skillId: string): boolean {
    if (!experimentGroup) {
      return false;
    }

    // Check if skill is eligible for matching interview pilot
    const pilotSkillIds = Config.getMatchingInterviewPilotSkillIds();
    const isSkillInPilot = Boolean(skillId && pilotSkillIds.has(skillId));

    return this.isVariant(experimentGroup) && isSkillInPilot;
  }

  private static isVariant(experimentGroup: ExperimentGroup): boolean {
    const variantGroups: ExperimentGroup[] = [ExperimentGroup.Group2, ExperimentGroup.Group3];
    return variantGroups.includes(experimentGroup);
  }
}
