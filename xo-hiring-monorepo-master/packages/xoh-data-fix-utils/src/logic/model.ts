export enum Action {
  None = 'None', // Nothing to do
  Restore = 'Restore', // Restore application to the specific stage
  Reject = 'Reject', // Reject the application
  NotifyHM = 'NotifyHM', // Notify HM about the application (typically when it should be rejected but already past the "breakpoint")
  Error = 'Error', // Investigate manually
}

export const AllStages = [
  'BFQ',
  'Commitment',
  'CCAT',
  'English',
  'SMQ',
  'FRQ',
  'Review',
  'Interview',
  'Marketplace',
  'Offer',
  'Onboarding',
  'Fraud-check',
  'Hired',
  'Rejected',
  'Canceled',
  'Expired',
];
export const IgnoreStages = ['Canceled', 'Expired'];

export interface ActionData {
  action: Action;
  appId: string;
  hint?: string;
  candidate: {
    name: string;
    email: string;
    title: string;
  };
}

export interface SObjectHistory {
  CreatedDate: string;
  Field: string;
  OldValue: string;
  NewValue: string;
  ParentId: string;
  OpportunityId: string;
}

export interface AffectedApplicationsData {
  asrId: string;
  asr: ApplicationStepResult;
  applications: Application[];
}

export interface ApplicationStepResult {
  Candidate__c: string;
  ApplicationId__r: {
    Candidate_Email__c: string;
    Advertised_Title__c: string;
    StageName: string;
  };
  Score__c: number;
  Raw_Score__c: number;
  ApplicationId__c: string;
  Id: string;
  Application_Step_Id__c: string;
  Application_Step_Id__r: {
    Name: string;
  };
  Application_Stage__c: string;
  Threshold__c: number;
  Reject_Threshold__c: number;
  State__c: string;
  Badge_Simulated__c: string;

  // Runtime-resolved fields
  history: SObjectHistory[]; // Field change history
}

export interface Application {
  Id: string;
  StageName: string;
  Pipeline__c: string;
  Advertised_Title__c: string;
  AccountId: string;
  Last_Active_Stage__c: string;
  Account: {
    Name: string;
    PersonEmail: string;
  };

  // Runtime-resolved fields
  aspm: ApplicationStepPipelineMapping; // ASPM related to the ASR
  history: SObjectHistory[]; // Field change history
  comment: string; // Generic comment generated based on the calculation
  action: Action; // Specific action should be performed for this application
  reason: string; // Reason for the action
  hint: string; // Additional info (depending on the action type)
}

export interface ApplicationStepPipelineMapping {
  PipelineId__c: string;
  ApplicationStepId__c: string;
  Pass_Threshold__c: number;
  Reject_Threshold__c: number;
  Retry_Threshold__c: number | null;
  Minimum_Proficiency__r?: {
    Stars__c: number;
    Pass_Threshold__c: number;
  };
}
