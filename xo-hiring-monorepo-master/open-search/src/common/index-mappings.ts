const analyzisConfiguration = {
  char_filter: {
    skills: {
      type: 'mapping',
      mappings: ['C# => csharp', 'F# => fsharp', 'C++ => _cpp_', '.NET => dotnet', '.Net => dotnet'],
    },
  },
  filter: {
    light_en_stemmer: {
      type: 'stemmer',
      language: 'light_english',
    },
  },
  analyzer: {
    prime_analyzer: {
      type: 'custom',
      tokenizer: 'standard',
      char_filter: ['skills'],
      filter: ['lowercase', 'stop', 'light_en_stemmer'],
    },
  },
};

/**
 * Index Mappings for OpenSearch SEARCH collection
 */
export const search = {
  all_candidates: {
    mappings: {
      properties: {
        candidateId: { type: 'keyword' },
        country: { type: 'text', analyzer: 'prime_analyzer' },
        lastActivity: { type: 'date' },
        workMidDay: { type: 'integer' },
        minCompPerHr: { type: 'integer' },
        availability: { type: 'keyword' },
        detectedTimezone: { type: 'float' },
        targetCompPerHr: { type: 'integer' },
        badges: {
          type: 'nested',
          properties: {
            id: { type: 'keyword' },
            stars: { type: 'integer' },
          },
        },
        jobTitles: { type: 'text', analyzer: 'prime_analyzer' },
        resumeProfile: { type: 'text', analyzer: 'prime_analyzer' },
        resumeFile: { type: 'text', analyzer: 'prime_analyzer' },
        acceptableCompensation: { type: 'integer' },
        desiredCompensation: { type: 'integer' },
        careerGoals: { type: 'text' },
        currentCompensation: { type: 'text' },
        currentCompensationPeriod: { type: 'text' },
        workingHours: {
          type: 'object',
          properties: {
            utcStart: { type: 'integer' },
            utcEnd: { type: 'integer' },
            flexible: { type: 'boolean' },
          },
        },
        availabilityToStart: { type: 'integer' },
        domains: { type: 'text' },
        bfqAnswers: {
          type: 'object',
        },
        bfqKeywords: { type: 'text' },
      },
    },
    settings: {
      analysis: analyzisConfiguration,
    },
  },
};

// OpenAI embedding model text-embedding-ada-002 has 1536 dimensions
export const VECTOR_SEARCH_DIMENSION = 1536;

/**
 * Index Mappings for OpenSearch VECTORSEARCH collection
 */
export const vectorSearch = {
  all_candidates: {
    mappings: {
      properties: {
        candidateId: { type: 'keyword' },
        acceptableCompensation: { type: 'integer' },
        availability: { type: 'keyword' },
        availabilityToStart: { type: 'integer' },
        badges: {
          type: 'nested',
          properties: { id: { type: 'keyword' }, stars: { type: 'integer' }, score: { type: 'integer' } },
        },
        bfqAnswers: { type: 'object' },
        bfqKeywords: { type: 'text' },
        careerGoals: { type: 'text' },
        country: { type: 'text' },
        currentCompensation: { type: 'text' },
        currentCompensationPeriod: { type: 'text' },
        desiredCompensation: { type: 'integer' },
        detectedTimezone: { type: 'float' },
        domains: { type: 'text' },
        isEmailBounced: { type: 'boolean' },
        jobTitles: { type: 'text', analyzer: 'prime_analyzer' },
        lastActivity: { type: 'date' },
        minCompPerHr: { type: 'integer' },
        resumeText: { type: 'text', analyzer: 'prime_analyzer' },
        resumeVector: {
          type: 'knn_vector',
          dimension: VECTOR_SEARCH_DIMENSION,
          method: {
            engine: 'nmslib',
            space_type: 'cosinesimil',
            name: 'hnsw',
            parameters: { ef_construction: 512, m: 16 },
          },
        },
        workingHours: {
          type: 'object',
          properties: { utcStart: { type: 'integer' }, utcEnd: { type: 'integer' }, flexible: { type: 'boolean' } },
        },
      },
    },
    settings: {
      index: {
        number_of_shards: 4,
        'knn.algo_param': { ef_search: 512 },
        knn: true,
      },
      analysis: analyzisConfiguration,
    },
  },
};
