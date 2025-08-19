export interface GradingRule {
  id: string;
  name: string;
  rule: string;
  passExamples?: string | null;
  failExamples?: string | null;
  applicationStepId: string;
  smKeyNamePattern?: string | null;
  aiGradingMode?: string | null;
  score?: string | null;
  contentType?: 'Auto' | 'Text' | 'URL' | null;
  model?: string | null;
}
