import { SessionDocument } from '../model/session';
import { R2Document } from '../schemas/matching-interview.schema';

// Pilot: Hard-coded R2 documents for the matching interview
const MATCHING_INTERVIEW_SKILL_PILOT: Record<string, R2Document> = {
  '19100000-0000-0000-0000-000000000000': {
    role: 'AI-First Lead Product Owner',
    minimumBarRequirements: `- 4+ years in product leadership role personally shaping vision, roadmap, problem-solution hypothesis
- Zero-to-one software product launch (full standalone product, not features)
- Strong analytical thinking, communication, and research skills
- Enthusiasm for using AI in daily work`,
    cultureFit: {
      loveFactors:
        'Figuring things out from scratch, chasing clarity in messy problems, obsessed with "why", proving impact with real data, AI as co-pilot',
      hateFactors:
        'Being given fixed feature lists, wanting handed-down plans, preferring detailed specs over forming opinions, needing external structure, hesitant about AI',
    },
  },
  '89000000-0000-0000-0000-000000000000': {
    role: 'AI-Augmented Full-Stack Principal Engineer',
    minimumBarRequirements: `- At least 4 years of experience writing production code for both the frontend and backend of web applications
  - At least 2 years of experience being the primary technical contributor for a development team OR software product.`,
    cultureFit: {
      loveFactors: `- You enjoy reading well writen technical specifications and understanding complex business requirements.
- You are pasionate about creating high-quality applications using cutting-edge technology.
- You enjoy writing code that is simple and solves the general case well and handle edge cases gracefully instead of creating complicated solutions that handle all edge cases perfectly.
- You enjoy working on complex B2B, Enterprise and SaaS applications.`,
      hateFactors: `- You don't think that working in fast-paced agile environment with daily iterations is right for producting high-quality apps.
- You don't like to have a daily calls with stakeholders and customers to get feedback on your deliverables.
- You are not well organized and don't like to work under pressure.`,
    },
  },
  '21600000-0000-0000-0000-000000000000': {
    role: 'AI-First Lead Product Owner',
    minimumBarRequirements: `
- 4+ years in a product leadership role in a product company, where you personally shaped an entire software product's vision, defined the roadmap, and improved it based on usage metrics or customer feedback (i.e., not just a feature or a module in a bigger product, and not internal development or outsourcing work or custom development done for a single customer)
- Some experience in product management of software used by large enterprises, so you can understand the particularities of how large enterprises choose, buy, and adopt software, compared to consumers or even SMBs.
- Enthusiasm for using AI in your daily work (e.g., research, analysis, synthesis, or strategy).
    `,
    cultureFit: {
      loveFactors: `- You love figuring things out from scratch.
- You chase clarity in messy problems.
- You're obsessed with "why" and never stop digging.
- You want to learn deeply, move fast, and prove you made a difference — with real users, real outcomes, and real data.`,
      hateFactors: `- You prefer being given a fixed list of features to spec out and hand off, without needing to understand the underlying problem, the customer, or the domain.
- You want someone to hand you a plan so you can execute it.
- You're more comfortable writing detailed execution-oriented specs than forming opinions on new topics.
- You need external structure and guardrails to think clearly, and prefer clarity to be given, not created.
- You're hesitant to use AI or resist integrating it into your daily workflow.`,
    },
  },
};

export class R2DocumentFetcher {
  static async fetch(session: SessionDocument): Promise<R2Document> {
    if (MATCHING_INTERVIEW_SKILL_PILOT[session.skillId] == null) {
      throw new Error(`R2 document not found for skill ${session.skillId}`);
    }
    return MATCHING_INTERVIEW_SKILL_PILOT[session.skillId];
  }
}
