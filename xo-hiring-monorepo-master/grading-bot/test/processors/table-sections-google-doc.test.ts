import { ContentExtraction } from '../../src/common/content-extraction';
import { GoogleDocs } from '../../src/integrations/google-docs';
import { GradingBotSsmConfig } from '../../src/integrations/ssm';
import { GradingTaskDocument } from '../../src/model/grading-task';
import { prepareStructuredTablePrompt } from '../../src/processors/table-sections-google-doc';

describe('table-sections-google-doc', () => {
  it('should generate prompts', async () => {
    // Arrange
    const task: GradingTaskDocument = {
      id: '1234',
      submissionLink: 'https://none.com',
      rules: [
        {
          failExamples: null,
          smKeyNamePattern: 'First%',
          applicationStepId: 'a082j000000PJk6AAG',
          name: 'Clear Response',
          rule: 'Is the response clear? Can a sufficiently technical person understand the technical challenges?',
          passExamples: null,
          id: 'a1Z0l000002tYVzEAM',
        },
        {
          failExamples: 'Hello Hello Hello',
          smKeyNamePattern: null,
          applicationStepId: 'a082j000000PJk6AAG',
          name: 'Should Print "Hello" 3 times',
          rule: 'Submission should include word "Hello" at least 3 times',
          passExamples: 'Welcome',
          id: 'a1Z0l000002tZX0EAM',
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
    GoogleDocs.fetchGoogleDocumentContent = jest.fn().mockResolvedValue({});
    ContentExtraction.extractSections = jest.fn().mockReturnValue([
      {
        header: 'First section',
        content: 'This is a candidate answer for the first section',
      },
      {
        header: 'Seconds section',
        content: 'Blah blah blah',
      },
    ]);

    // Act
    const result = await prepareStructuredTablePrompt(task, config);

    // Assert
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      messages: [
        {
          content:
            "ChatGPT, as an expert technical interviewer you are grading candidate's submission.\nGrading Rule:\nIs the response clear? Can a sufficiently technical person understand the technical challenges?\n        \nPass Examples: \n\n        \nFail Examples: \n",
          role: 'system',
        },
        {
          content: "Candidate's submission:\n\n===\nThis is a candidate answer for the first section\n===",
          role: 'user',
        },
      ],
    });
    expect(result[1]).toMatchObject({
      messages: [
        {
          content:
            'ChatGPT, as an expert technical interviewer you are grading candidate\'s submission.\nGrading Rule:\nSubmission should include word "Hello" at least 3 times\n        \nPass Examples: \nWelcome\n        \nFail Examples: \nHello Hello Hello',
          role: 'system',
        },
        {
          content:
            "Candidate's submission:\n\n===\nThis is a candidate answer for the first section\nBlah blah blah\n===",
          role: 'user',
        },
      ],
    });
  });
});
