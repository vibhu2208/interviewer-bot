export interface MainTableKeys {
  pk: string;
  sk?: string;
}

export function getSessionKey(sessionId: string): MainTableKeys {
  return {
    pk: `SESSION#${sessionId}`,
    sk: `SESSION`,
  };
}

export function getQuestionKey(sessionId: string, questionId: string): MainTableKeys {
  return {
    pk: `SESSION#${sessionId}`,
    sk: `QUESTION#${questionId}`,
  };
}

export function getSkillKey(skillId: string): MainTableKeys {
  return {
    pk: `SKILL#${skillId}`,
    sk: `SKILL`,
  };
}

export function getGeneratorKey(generatorId: string): MainTableKeys {
  return {
    pk: `GEN#${generatorId}`,
    sk: `GEN`,
  };
}
