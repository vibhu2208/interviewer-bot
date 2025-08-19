import { z } from 'zod';

export const RequirementMetEnumSchema = z
  .enum(['YES', 'WEAK_PASS', 'UNCLEAR', 'NO'])
  .describe(
    'How well the candidate meets this requirement: YES = clear evidence, WEAK_PASS = marginal evidence, UNCLEAR = insufficient info gathered, NO = clear evidence of not meeting',
  );
export type RequirementMetEnum = z.infer<typeof RequirementMetEnumSchema>;

export const MatchingInterviewGradingSchema = z.object({
  interviewerQuality: z.object({
    score: z.number().describe('Score out of 100 for the interviewer quality'),
    summary: z.string().describe('Summary of the interviewer quality'),
    improvements: z.string().describe('Specific improvements to the interviewer quality'),
  }),

  gradingRubricResults: z
    .object({
      requirements: z.array(
        z.object({
          requirement: z.string().describe('The specific requirement being evaluated'),
          met: RequirementMetEnumSchema,
          evidence: z.string().describe('Specific evidence supporting this determination'),
          gaps: z.string().optional().describe('Any gaps or deficiencies identified'),
        }),
      ),
    })
    .describe('Graded determinations for each minimum bar requirement with weighted scoring'),

  comprehensiveProfile: z
    .object({
      capabilities: z
        .array(z.string())
        .describe(
          'Role-focused capabilities: Demonstrated skills and competencies directly relevant to this specific role',
        ),
      experience: z
        .array(z.string())
        .describe(
          'Relevant experience: Work history, projects, and accomplishments that relate to the role requirements',
        ),
      skillGaps: z
        .array(z.string())
        .describe(
          'Actual deficiencies: Clear gaps in required skills, knowledge, or experience that could impact role performance',
        ),
      uncertainties: z
        .array(z.string())
        .describe(
          'Insufficient information: Areas where the interview failed to gather enough data to make confident assessments',
        ),
      concerns: z
        .array(z.string())
        .describe(
          'Red flags and credibility issues: Potential problems with reliability, consistency, or fit that require attention',
        ),
      notes: z
        .array(z.string())
        .describe('Additional observations: Important context, nuances, or insights that inform the hiring decision'),
    })
    .describe('Structured candidate assessment focused on actionable hiring decision factors'),
});
export type MatchingInterviewGrading = z.infer<typeof MatchingInterviewGradingSchema>;
