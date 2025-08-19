import { ChatCompletionCreateParams } from 'openai/resources';

/**
 * The argument is of type CandidateSubmissionGrading
 */
export const GradeCandidateSubmission: ChatCompletionCreateParams.Function = {
  name: 'gradeSubmission',
  description: 'Grade submission provided by the candidate',
  parameters: {
    type: 'object',
    properties: {
      result: {
        type: 'string',
        enum: ['Pass', 'Fail', 'Unknown'],
        description:
          'Pass if the submission objectively satisfies the grading rule. Fail if the submission objectively not satisfies the grading rule. Unknown otherwise',
      },
      confidence: {
        type: 'number',
        description: 'Confidence score (decimal from 0 to 1) - How confident are you in your grading',
      },
      reasoning: {
        type: 'string',
        maxLength: 100,
        description: 'Explain the reason for the grading',
      },
      feedback: {
        type: 'string',
        maxLength: 200,
        description: 'Explain what could have improved the submission, no more than 300 characters',
      },
    },
    required: ['result', 'confidence', 'reasoning', 'feedback'],
  },
};

export interface CandidateSubmissionGrading {
  result: 'Pass' | 'Fail' | 'Unknown';
  confidence: number;
  reasoning: string;
  feedback: string;
}
