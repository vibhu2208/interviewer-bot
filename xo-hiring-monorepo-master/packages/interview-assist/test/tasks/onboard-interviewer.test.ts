import { onboardInterviewer } from '../../src/tasks/onboard-interviewer';
import { Salesforce } from '@trilogy-group/xoh-integration';
import { Interviewer } from '../../src/models/interviewer';

jest.mock('@trilogy-group/xoh-integration', () => {
  return {
    defaultLogger: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
    Salesforce: {
      getDefaultClient: jest.fn(),
      silent: jest.fn(),
    },
  };
});

jest.mock('../../src/models/interviewer');

describe('onboardInterviewer', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should onboard the interviewer if a grader is found for the transcript', async () => {
    // Arrange
    const mockSfClient = {
      // Return a result with a single grader
      querySOQL: jest.fn(async () => [{ Grader__c: 'GRADER-123' }]),
    };
    (Salesforce.getDefaultClient as jest.Mock).mockReturnValue(mockSfClient);

    // Act
    await onboardInterviewer('ASR-999');

    // Assert: Confirm the correct query was made
    expect(mockSfClient.querySOQL).toHaveBeenCalledWith(
      "SELECT Grader__c FROM Application_Step_Result__c WHERE Id = 'ASR-999' LIMIT 1",
    );

    // Assert: Confirm upsert is called
    expect(Interviewer.upsert).toHaveBeenCalledWith({
      interviewerId: 'GRADER-123',
      isOnboarded: true,
    });
  });

  it('should log an error and skip upserting if no grader is found', async () => {
    // Arrange
    const mockSfClient = {
      // Return an empty array
      querySOQL: jest.fn(async () => []),
    };
    (Salesforce.getDefaultClient as jest.Mock).mockReturnValue(mockSfClient);

    // Act
    await onboardInterviewer('ASR-999');

    // Assert: Confirm the correct query was made
    expect(mockSfClient.querySOQL).toHaveBeenCalledWith(
      "SELECT Grader__c FROM Application_Step_Result__c WHERE Id = 'ASR-999' LIMIT 1",
    );
    // Assert: upsert is not called
    expect(Interviewer.upsert).not.toHaveBeenCalled();
  });
});
