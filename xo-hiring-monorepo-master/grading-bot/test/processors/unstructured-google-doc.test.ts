import { ContentExtraction } from '../../src/common/content-extraction';
import { GradingBotSsmConfig } from '../../src/integrations/ssm';
import { GoogleDocs } from '../../src/integrations/google-docs';
import { GradingTaskDocument } from '../../src/model/grading-task';
import { prepareDefaultPrompt } from '../../src/processors/unstructured-google-doc';

describe('unstructured-google-doc', () => {
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
        unstructuredSystem: `
ChatGPT, as an expert technical interviewer you are grading candidate's submission.
Grading Rule:
{{rule.rule}}
        
Pass Examples: 
{{rule.passExamples}}
        
Fail Examples: 
{{rule.failExamples}}
        `.trim(),
        unstructuredUser: `
Candidate's submission:

===
{{content}}
===
        `.trim(),
      },
    } as any;
    GoogleDocs.fetchGoogleDocumentContent = jest.fn().mockResolvedValue({});
    ContentExtraction.extractText = jest.fn().mockReturnValue('My house is red, i clean it 8 times per day');

    // Act
    const result = await prepareDefaultPrompt(task, config);

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
          content: "Candidate's submission:\n\n===\nMy house is red, i clean it 8 times per day\n===",
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
          content: "Candidate's submission:\n\n===\nMy house is red, i clean it 8 times per day\n===",
          role: 'user',
        },
      ],
    });
  });
});
