import { prepareSMResponsesPrompt } from '../../src/processors/sm-response';
import { GradingBotSsmConfig } from '../../src/integrations/ssm';
import { GradingTaskDocument } from '../../src/model/grading-task';

describe('sm-response', () => {
  it('should generate prompts', async () => {
    // Arrange
    const task: GradingTaskDocument = {
      rules: [
        {
          applicationStepId: 'a082j0000094rLGAAY',
          failExamples: null,
          id: 'a1Z0l000002tZc4EAE',
          name: 'Clean Response',
          passExamples: null,
          rule: 'Is the response clear? Can a sufficiently technical person understand the technical challenges?',
          smKeyNamePattern: null,
        },
        {
          applicationStepId: 'a082j0000094rLGAAY',
          failExamples: 'Rely only on Open Rate, rely only on Unsubscribe Rate',
          id: 'a1Z0l000002tZcEEAU',
          name: 'Q1 Grading',
          passExamples: 'Check Clickthrough Rate, check Conversion Rate',
          rule: "The candidate's answer should mention performance metrics over time and see what items are falling and try generate an insight tied to any performance metric",
          smKeyNamePattern: 'Q1:%',
        },
        {
          applicationStepId: 'a082j0000094rLGAAY',
          failExamples: null,
          id: 'a1Z0l000002tZcJEAU',
          name: 'Q2 Grading',
          passExamples: null,
          rule: "The candidate's answer should mention lack of variety of content, exhaustion, lack of compelling copy, failure to interact meaningfully with the audience through personalization",
          smKeyNamePattern: '%typical problems%',
        },
      ],
      status: 'Graded',
      submission: [
        {
          answer:
            'The first metric I’ll check is the CTR (Clickthrough Rate). While it is tempting to check the Open Rate or Unsubscribe Rate first, either metric can be misleading. The Open Rate metric can be thwarted by email client settings that withhold feedback data, while the Unsubscribe Rate can mask underlying issues, as recipients may not even bother going through the process of unsubscribing.   \r\n\r\nThe CTR (along with the conversion rate) is the easiest and most reliable metric to measure the success of an email campaign. Combined with other kinds of data about the customer base (e.g. industry and segment types, company sizes, management levels of the recipients, etc.), CTR provides insight into potential reasons for the campaign slump. With a combination of A/B testing and CTR for instance, I can figure out whether the problem is the email content itself. I can also run a multilinear regression that uses CTR as a dependent variable to determine which factors are most critical in securing conversion.',
          question: 'Q1: What do you analyze first and why?',
        },
        {
          answer:
            'Some common reasons for a poorly performing campaign are boring/repetitive subject lines, uninspiring calls-to-action, and a lack of proper client segmentation. However, such typical problems are usually evident from the start of the campaign. A campaign that falls off halfway through might indicate that the messaging itself has grown stale over time. Copywriting that revolves around a singular creative ‘big idea’, or harps on only one or two USPs, is especially prone to this fate. An email campaign is better off with multiple creative angles to keep the messaging fresh.\r\n\r\nIt is also important to note that a lower CTR in the middle of an email campaign may not necessarily mean the campaign is failing, especially with an already established customer base. For example, if CTR and conversion rates were high in the first four weeks, it is entirely possible that a good percentage of the customer base adopted the new software functionality during that period, and is now opting to ignore reminders. The reasons why a campaign is ‘losing steam’ can be multi-faceted, and it is important to consider multiple metrics concurrently to arrive at holistic conclusions.',
          question: 'Q2: What are the typical problems that would have driven performance falloff?',
        },
      ],
    } as any;
    const config: GradingBotSsmConfig = {
      prompts: {
        structuredSystem: `
ChatGPT, as an expert technical interviewer you are grading candidate's submission.
Grading Rule:
{{rule.rule}}
        
Pass Examples: 
{{rule.passExamples}}
        
Fail Examples: 
{{rule.failExamples}}
        `.trim(),
        structuredUser: `
Candidate's submission:

===
{{#each contents}}
{{answer}}

{{/each}}
===
        `.trim(),
      },
    } as any;

    // Act
    const result = await prepareSMResponsesPrompt(task, config);

    // Assert
    expect(result.length).toBe(3);
    expect(result[0]).toMatchObject({
      messages: [
        {
          content:
            "ChatGPT, as an expert technical interviewer you are grading candidate's submission.\nGrading Rule:\nIs the response clear? Can a sufficiently technical person understand the technical challenges?\n        \nPass Examples: \n\n        \nFail Examples: \n",
          role: 'system',
        },
        {
          content:
            "Candidate's submission:\n\n===\nThe first metric I’ll check is the CTR (Clickthrough Rate). While it is tempting to check the Open Rate or Unsubscribe Rate first, either metric can be misleading. The Open Rate metric can be thwarted by email client settings that withhold feedback data, while the Unsubscribe Rate can mask underlying issues, as recipients may not even bother going through the process of unsubscribing.   \r\n\r\nThe CTR (along with the conversion rate) is the easiest and most reliable metric to measure the success of an email campaign. Combined with other kinds of data about the customer base (e.g. industry and segment types, company sizes, management levels of the recipients, etc.), CTR provides insight into potential reasons for the campaign slump. With a combination of A/B testing and CTR for instance, I can figure out whether the problem is the email content itself. I can also run a multilinear regression that uses CTR as a dependent variable to determine which factors are most critical in securing conversion.\n\nSome common reasons for a poorly performing campaign are boring/repetitive subject lines, uninspiring calls-to-action, and a lack of proper client segmentation. However, such typical problems are usually evident from the start of the campaign. A campaign that falls off halfway through might indicate that the messaging itself has grown stale over time. Copywriting that revolves around a singular creative ‘big idea’, or harps on only one or two USPs, is especially prone to this fate. An email campaign is better off with multiple creative angles to keep the messaging fresh.\r\n\r\nIt is also important to note that a lower CTR in the middle of an email campaign may not necessarily mean the campaign is failing, especially with an already established customer base. For example, if CTR and conversion rates were high in the first four weeks, it is entirely possible that a good percentage of the customer base adopted the new software functionality during that period, and is now opting to ignore reminders. The reasons why a campaign is ‘losing steam’ can be multi-faceted, and it is important to consider multiple metrics concurrently to arrive at holistic conclusions.\n\n===",
          role: 'user',
        },
      ],
    });
  });
});
