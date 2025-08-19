import { shouldRecommendJobs } from '../src/internal-handlers/job-recommendations';

describe('shouldRecommendJobs', () => {
  test('returns true when all conditions are met', () => {
    const candidate = {
      Id: '1',
      HasResume__c: true,
      CCAT_Score__c: '36',
      Job_Recommendations__r: null,
    };
    expect(shouldRecommendJobs(candidate)).toBe(true);
  });

  test('returns false when CCAT score is below 35', () => {
    const candidate = {
      Id: '1',
      HasResume__c: true,
      CCAT_Score__c: '34',
      Job_Recommendations__r: null,
    };
    expect(shouldRecommendJobs(candidate)).toBe(false);
  });

  test('returns false when candidate already has job recommendations', () => {
    const candidate = {
      Id: '1',
      HasResume__c: true,
      CCAT_Score__c: '36',
      Job_Recommendations__r: { totalSize: 1 },
    };
    expect(shouldRecommendJobs(candidate)).toBe(false);
  });

  test('returns false when candidate does not have a resume', () => {
    const candidate = {
      Id: '1',
      HasResume__c: false,
      CCAT_Score__c: '36',
      Job_Recommendations__r: null,
    };
    expect(shouldRecommendJobs(candidate)).toBe(false);
  });

  test('handles edge case when CCAT score is exactly 35', () => {
    const candidate = {
      Id: '1',
      HasResume__c: true,
      CCAT_Score__c: '35',
      Job_Recommendations__r: { totalSize: 0 },
    };
    expect(shouldRecommendJobs(candidate)).toBe(true);
  });
});
