export default {
  LLM_DEFINITION: {
    model: 'arn:aws:bedrock:us-east-1:104042860393:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0',
    provider: 'bedrock',
    projectName: 'interviewBot',
  } as const,
  // SANDBOX
  INTERVIEW_BOT_API_URL: 'https://sandbox-assessments-api-rest.crossover.com',
  INTERVIEW_BOT_GQL_API_URL: 'https://imk2yne5prdvjpdcr46dphfovu.appsync-api.us-east-1.amazonaws.com/graphql',
  TEST_SKILL_IDS: ['21600000-0000-0000-0000-000000000000'],
  TEST_GROUP: '3',
  INTERVIEW_BOT_GQL_API_KEY: 'da2-mpj2xborkzdkfbkzizzbr3jnny',
};
