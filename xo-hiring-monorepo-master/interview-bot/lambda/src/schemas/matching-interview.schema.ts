import { z } from 'zod';

export const InterviewResponseSchema = z
  .object({
    message: z.string().describe('Your conversational response to the candidate'),
    readyForGrading: z
      .boolean()
      .describe(
        'Whether sufficient information has been gathered for comprehensive assessment - only true if you have gathered all information AND concluded the conversation professionally with goodbye',
      ),
  })
  .describe('Interview response with message and grading readiness status');
export type InterviewResponseSchemaType = z.infer<typeof InterviewResponseSchema>;

export interface R2Document {
  role: string;
  minimumBarRequirements: string;
  cultureFit: {
    loveFactors: string;
    hateFactors: string;
  };
}
