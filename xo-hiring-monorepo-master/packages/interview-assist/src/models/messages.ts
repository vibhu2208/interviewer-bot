export interface GenerateSummaryMessage {
  type: 'generate-summary';
  transcriptId: string;
  promptId?: string;
}

export interface OnboardInterviewerMessage {
  type: 'onboard-interviewer';
  transcriptId: string;
}

export type TaskMessage = GenerateSummaryMessage | OnboardInterviewerMessage;
