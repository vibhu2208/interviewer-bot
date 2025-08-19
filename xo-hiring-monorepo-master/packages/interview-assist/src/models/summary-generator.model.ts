import { Elements, IContentItem } from '@kontent-ai/delivery-sdk';

export interface BadgeData {
  name: string;
  description: string;
  level: string;
  proficiency: number;
  maxProficiency: number;
}

export interface CandidateData {
  resume?: string;
  profile?: string;
}

export interface InterviewConversation {
  sourceName: string;
  // Note: The original getAIInterviewConversations from asr-data.service.ts does not populate this field.
  interviewDate?: string;
  conversation: Array<{
    role: 'Candidate' | 'Interviewer' | string;
    content: string;
  }>;
}

export interface AsrContextualIds {
  pipelineId: string;
  candidateId: string;
  applicationId: string;
}

export type KontentPipelineItem = IContentItem<{
  pipeline_code: Elements.NumberElement;
  hook: Elements.RichTextElement;
  what_you_will_be_doing: Elements.RichTextElement;
  what_you_will_not_be_doing: Elements.RichTextElement;
  responsibilities: Elements.RichTextElement;
  requirements: Elements.RichTextElement;
  nice_to_have: Elements.RichTextElement;
  what_you_will_learn: Elements.RichTextElement;
  work_examples: Elements.RichTextElement;
  primary_contribution: Elements.RichTextElement;
}>;

export interface KontentPipelineDescription {
  pipeline_code: string;
  pipeline_name: string;
  hook: string;
  what_you_will_be_doing: string;
  what_you_will_not_be_doing: string;
  responsibilities: string;
  requirements: string;
  nice_to_have: string;
  what_you_will_learn: string;
  work_examples: string;
}

export interface ComprehensiveInterviewContext {
  jobDescription: KontentPipelineDescription;
  candidateResume?: CandidateData;
  candidateBadges?: BadgeData[];
  matchingInterviewLogs: InterviewConversation[];
  regularInterviewLog: InterviewConversation;
  candidateId?: string | null;
  interviewQA?: InterviewQuestionAnswer[];
}

export interface InterviewQuestionAnswer {
  sourceAssessmentName: string;
  question: string;
  answer: string;
}

export interface ProcessedAssessment {
  assessmentName: string;
  stepDisplayName: string;
  applicationId: string;
  badgeName?: string;
  badgeStars?: number;
  badgeDescription?: string;
  badgeMaxProficiency?: number;
  provider?: string;
  externalAssessmentId?: string;
  externalSubmissionId?: string;
  surveyResponses?: Array<{
    question: string;
    response: string;
  }>;
  applicationStage?: string;
  submissionTime?: Date;
}
