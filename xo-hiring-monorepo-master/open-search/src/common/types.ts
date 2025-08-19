export type IndexItemMessage = {
  candidateId?: string;
  objectKey?: string;
  operation: 'update' | 'remove' | undefined;
};
