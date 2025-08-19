import { Elements, IContentItem } from '@kontent-ai/delivery-sdk';
import { defaultLogger, SalesforceClient, Llm, LlmDefinition } from '@trilogy-group/xoh-integration';
import { z } from 'zod';
import { generateObject, CoreMessage } from 'ai';
import { Kontent } from '../integrations/kontent';
import { LLMProjectName } from '../utils/common';

const log = defaultLogger({ serviceName: 'job-ads-title-variation-gen' });

export class JobTitleVariationGenerationService {
  static getLLMProviders(): LLMProvider[] {
    return [ChatGptProvider, ClaudeBedrockProvider37, ClaudeBedrockProvider35V2];
  }

  static getPromptProviders(): PromptProvider[] {
    return [OriginalPromptProvider, HeatherPromptProvider];
  }

  static async fetchKontentData(pipelineCodes: string[]): Promise<KontentPipelineItem[]> {
    const kontentClient = await Kontent.deliveryClient();

    const response = await kontentClient
      .items<KontentPipelineItem>()
      .type('pipeline')
      .elementsParameter([
        'pipeline_code',
        'hook',
        'what_you_will_be_doing',
        'what_you_will_not_be_doing',
        'responsibilities',
        'requirements',
        'nice_to_have',
        'what_you_will_learn',
        'work_examples',
        'primary_contribution',
      ])
      .inFilter('elements.pipeline_code', pipelineCodes)
      .depthParameter(2)
      .toPromise();

    return response.data.items;
  }

  static async fetchActivePipelinesWithJobTitles(sf: SalesforceClient): Promise<Pipeline[]> {
    const query = `
        SELECT Id,
               ProductCode,
               Name,
               (SELECT Id, Name, Job_Title__c
                FROM Pipeline_Job_Titles__r
                WHERE Is_Active__c = TRUE)
        FROM Product2
        WHERE Status__c = 'Active'
          AND Job_Board_Ads__c = TRUE
    `;

    try {
      const results = await sf.querySOQL<Pipeline>(query);
      log.info(`Fetched ${results.length} active pipelines with job titles`);
      return results;
    } catch (error) {
      log.error('Error fetching active pipelines with job titles', error as Error);
      throw error;
    }
  }
}

const ChatGptProvider: LLMProvider = {
  getId: () => 'gpt-4o',
  generateVariation: async (
    input: VariationGenerationInput,
    prompt: PromptProvider,
  ): Promise<GeneratedOutput | null> => {
    return await invokeLLM(input, prompt, {
      provider: 'openai',
      projectName: LLMProjectName,
      model: 'gpt-4o',
    });
  },
};

const ClaudeBedrockProvider35V2: LLMProvider = {
  getId: () => 'claude-3.5-v2',
  generateVariation: async (
    input: VariationGenerationInput,
    prompt: PromptProvider,
  ): Promise<GeneratedOutput | null> => {
    return await invokeLLM(input, prompt, {
      provider: 'bedrock',
      projectName: LLMProjectName,
      model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    });
  },
};

const ClaudeBedrockProvider37: LLMProvider = {
  getId: () => 'claude-3.7',
  generateVariation: async (
    input: VariationGenerationInput,
    prompt: PromptProvider,
  ): Promise<GeneratedOutput | null> => {
    return await invokeLLM(input, prompt, {
      provider: 'bedrock',
      projectName: LLMProjectName,
      model: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    });
  },
};

const OriginalPromptProvider: PromptProvider = {
  getId: () => 'original-prompt',
  getSystemPrompt: () => {
    return `
You are an expert HR professional and creative writer tasked with rewriting job descriptions. 
You will be given a job title and a detailed job description. 
Your goal is to create a fresh variation of the original job description while maintaining all the essential information.

Input:
Job Title,
Original Job Description,
The original job description may include some or all of the following sections:
- Hook
- What you will be doing
- What you will not be doing
- Responsibilities
- Requirements
- Nice to have
- What you will learn
- Work examples
- Primary contribution

Instructions:
1. Carefully read and analyze the provided job description and title.
2. You are free to retain only crucial information from the original description.
3. Rewrite the job description using a different tone and structure while ensuring it remains professional and appropriate for the industry.
4. You are encouraged to change the structure as much as possible.
5. Ensure that all sections present in the original description are addressed in your variation, even if you reorganize them.
6. Use creative language and phrasing to make the description more engaging and unique.
7. Tailor the language to the target audience (potential job applicants).
8. Proofread your variation for clarity, coherence, and proper grammar.
9. Use simple HTML formatting (p, br, ul, li) to present text content.

Output:
Provide the rewritten job description in JSON format, with a field for each section. 
Include only the sections that were present in the original description. The JSON structure should be as follows:

{
  "hook": "Rewritten hook text",
  "whatYouWillBeDoing": "Rewritten 'What you will be doing' text",
  "whatYouWillNotBeDoing": "Rewritten 'What you will not be doing' text",
  "responsibilities": "Rewritten responsibilities text",
  "requirements": "Rewritten requirements text",
  "niceToHave": "Rewritten 'Nice to have' text",
  "whatYouWillLearn": "Rewritten 'What you will learn' text",
  "workExamples": "Rewritten work examples text",
  "primaryContribution": "Rewritten primary contribution text"
}

Ensure that all key information is preserved and presented in a new, creative way within this JSON structure. 
Only output JSON and nothing else!   
    `.trim();
  },
  getUserPrompt: getStandardJobAdDescription,
};

const HeatherPromptProvider: PromptProvider = {
  getId: () => 'heather-prompt',
  getSystemPrompt: () => {
    return `
Act as a expert digital copywriter, who specializes in engaging, edgy, differentiated job postings for companies
who hire top 1% talent globally. You adapt your tone based on the ideal candidate for each job. You also
ensure that every posting aligns with the corporate voice, which is:
- Direct
- Concise
- Professional
- Aspirational / Motivational
- Confident
- Authoritative
- Instructional
- Assertive
- Somewhat exclusive (conveys a sense the role is intended for specific people)
- Not negative
- Not ambiguous
- Not complacent
- Not informal

You begin each job posting with a catchy, engaging hook that clearly attracts the ideal candidate. You then
provide 2-3 paragraphs that describe the role and the company. This should be a total of 200-500 words.
The next section is What You Will Be Doing. In this section, you provide 3-5 bullet points that describe the daily
work of the role.

The next section is What You Will NOT Be Doing. In this section, you write 2-5 bullet points that describe
common tasks in similar roles that are not part of this job. You consider what the ideal candidate currently
experiences as pain points or drudgery in their role. You also think about the unique aspects of the
job/company and highlight what makes this position different. You should ask me about this, but you can also
suggest common duties in similar roles, pain points, or unique aspects of this job and ask for my validation.
The final section is Responsibilities. In this section, you write one sentence that encapsulates the most
important thing this role is responsible for – the business outcome. This is why this role exists. This sentence
should summarize what important business change or outcome is made possible by the position.
Describe and validate the ideal candidate and your understanding of the role via a short summary.
You should consider the ideal candidate and what would excite and motivate them, what questions they might
have, and how the role solves their current pain points.
Create a job description that matches the structure and corporate voice described above.

Output:
Provide the rewritten job description in JSON format, with a field for each section. 
You are allowed to use simple HTML formatting (p, br, ul, li) to present text content.
Include only the sections that were present in the original description. The JSON structure should be as follows:

{
  "hook": "Rewritten hook text",
  "whatYouWillBeDoing": "Rewritten 'What you will be doing' text",
  "whatYouWillNotBeDoing": "Rewritten 'What you will not be doing' text",
  "responsibilities": "Rewritten responsibilities text",
  "requirements": "Rewritten requirements text",
  "niceToHave": "Rewritten 'Nice to have' text",
  "whatYouWillLearn": "Rewritten 'What you will learn' text",
  "workExamples": "Rewritten work examples text",
  "primaryContribution": "Rewritten primary contribution text"
}    

Only output JSON and nothing else!
    `.trim();
  },
  getUserPrompt: getStandardJobAdDescription,
};

function getStandardJobAdDescription(input: VariationGenerationInput): string {
  return `
Job Information:
Job Title: ${input.jobTitle.Job_Title__c}
Job Description:

Hook: 
${input.kontentData.elements.hook.value ?? 'null'}

What you will be doing:
${input.kontentData.elements.what_you_will_be_doing.value ?? 'null'}

What you will not be doing:
${input.kontentData.elements.what_you_will_not_be_doing.value ?? 'null'}

Responsibilities:
${input.kontentData.elements.responsibilities.value ?? 'null'}

Requirements:
${input.kontentData.elements.requirements.value ?? 'null'}

Nice to have:
${input.kontentData.elements.nice_to_have.value ?? 'null'}

What you will learn:
${input.kontentData.elements.what_you_will_learn.value ?? 'null'}

Work examples:
${input.kontentData.elements.work_examples.value ?? 'null'}

Primary contribution:
${input.kontentData.elements.primary_contribution.value ?? 'null'}
  `.trim();
}

async function invokeLLM(
  input: VariationGenerationInput,
  prompt: PromptProvider,
  llmDefinition: LlmDefinition,
): Promise<GeneratedOutput | null> {
  try {
    const llmModel = await Llm.getModel(llmDefinition);
    const messages: CoreMessage[] = [
      { role: 'system', content: prompt.getSystemPrompt(input) },
      { role: 'user', content: prompt.getUserPrompt(input) },
    ];

    const response = await generateObject({
      messages,
      model: llmModel,
      temperature: 0.6,
      maxTokens: 4000,
      schema: GeneratedOutputSchema,
    });

    if (!response?.object) {
      return null;
    }

    return response.object;
  } catch (error) {
    log.warn(`Error generating variation with model: ${llmDefinition.model}`, error as Error);
    return null;
  }
}

export interface LLMProvider {
  getId: () => string;
  generateVariation: (input: VariationGenerationInput, prompt: PromptProvider) => Promise<GeneratedOutput | null>;
}

export interface PromptProvider {
  getId: () => string;
  getSystemPrompt: (input: VariationGenerationInput) => string;
  getUserPrompt: (input: VariationGenerationInput) => string;
}

export interface VariationGenerationInput {
  pipeline: Pipeline;
  jobTitle: PipelineJobTitle;
  kontentData: KontentPipelineItem;
}

export interface PipelineJobTitle {
  Id: string;
  Name: string;
  Job_Title__c: string;
}

export interface Pipeline {
  Id: string;
  ProductCode: string;
  Name: string;
  Pipeline_Job_Titles__r?: {
    records: PipelineJobTitle[];
  };
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

const GeneratedOutputSchema = z.object({
  hook: z.string().optional(),
  whatYouWillBeDoing: z.string().optional(),
  whatYouWillNotBeDoing: z.string().optional(),
  responsibilities: z.string().optional(),
  requirements: z.string(),
  niceToHave: z.string().optional(),
  whatYouWillLearn: z.string().optional(),
  workExamples: z.string().optional(),
  primaryContribution: z.string().optional(),
});

export type GeneratedOutput = z.infer<typeof GeneratedOutputSchema>;
