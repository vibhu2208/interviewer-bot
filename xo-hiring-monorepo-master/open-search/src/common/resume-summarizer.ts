import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

export class ResumeSummarizer {
  private readonly bedrockClient = new BedrockRuntimeClient();

  public async summarize(...docs: string[]): Promise<string> {
    const document = docs.join('\n\n');

    try {
      console.log('Summarizing resumes...');

      const command = new ConverseCommand({
        messages: [{ role: 'user', content: [{ text: createPrompt(document) }] }],
        modelId: 'amazon.nova-lite-v1:0',
        inferenceConfig: { temperature: 0, maxTokens: 5120 },
      });

      const response = await this.bedrockClient.send(command);
      const textContent = response.output?.message?.content?.map((c) => c.text).filter((t) => t)[0];

      console.log(`Successfully summarized resumes`);

      return textContent ?? '';
    } catch (error) {
      console.error(`Error summarizing resumes:`, error);

      console.info('Falling back to original document');
      return document;
    }
  }
}

function createPrompt(document: string) {
  const prompt = `
    Extract key information from this resume following this exact format:

    <Output Template>
    Technical Skills (if any):
    [List specific technical tools, technologies, platforms with clear evidence of use]

    Demonstrated Skills:
    [List specific non-technical skills and competencies shown through work]

    Core Activities:
    [List specific implementations, projects, and achievements]

    Professional Background:
    [List relevant education, certifications, and experience progression]

    Domain Experience:
    [List specific industries and specialized areas worked in]

    Work Context:
    [List types of environments, products/services, and audiences served]
    </Output Template>

    <Example Technical Resume Input>
    Built AWS infrastructure for healthcare startup. Implemented Python monitoring systems. Created patient portal using React. BS in Computer Science. Led development of medical billing system.
    </Example Technical Resume Input>

    <Example Technical Output>
    Technical Skills:
    AWS, Python, React

    Demonstrated Skills:
    Infrastructure development, system monitoring, technical leadership

    Core Activities:
    Build cloud infrastructure, implement monitoring systems, create healthcare portals, lead development teams

    Professional Background:
    Bachelor's in Computer Science

    Domain Experience:
    Healthcare technology, medical systems

    Work Context:
    Startup environment, healthcare applications, patient-facing systems
    </Example Technical Output>

    <Example Non-Technical Resume Input>
    Developed new math curriculum for grades 6-8. Led team of 5 teachers. Increased student test scores by 25%. Master's in Education, certified math teacher.
    </Example Non-Technical Resume Input>

    <Example Non-Technical Output>
    Technical Skills:
    None specified

    Demonstrated Skills:
    Curriculum development, team leadership, mathematics instruction

    Core Activities:
    Develop curriculum, lead teaching team, improve student performance metrics

    Professional Background:
    Master's in Education, teaching certification

    Domain Experience:
    Middle school education, mathematics education

    Work Context:
    Classroom environment, standardized testing, team leadership
    </Example Non-Technical Output>

    Important:
    - Separate technical skills from other skills when present
    - Include only skills and experience with clear evidence
    - Focus on specific accomplishments and activities
    - Maintain consistent phrasing
    - List concrete details rather than general claims
    - Avoid using quantities (e.g. 5 years, 3+ years)

    <Resume Input>
    ${document}
    </Resume Input>

    Respond with only what's inside the <Output Template />.`;

  return prompt;
}
