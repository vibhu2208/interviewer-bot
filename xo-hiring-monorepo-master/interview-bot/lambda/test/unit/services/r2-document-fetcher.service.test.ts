import { R2DocumentFetcher } from '../../../src/services/r2-document-fetcher.service';
import { SessionDocument } from '../../../src/model/session';

describe('R2DocumentFetcher', () => {
  const validSkillIds = [
    '19100000-0000-0000-0000-000000000000',
    '89000000-0000-0000-0000-000000000000',
    '21600000-0000-0000-0000-000000000000',
  ];
  const invalidSkillId = 'invalid-skill-id';

  describe('fetch', () => {
    describe('when skill ID exists in pilot', () => {
      it.each(validSkillIds)('should return R2Document for skill ID %s', async (skillId) => {
        const session = { skillId } as SessionDocument;

        const result = await R2DocumentFetcher.fetch(session);

        expect(result).toBeDefined();
        expect(result.role).toBeDefined();
        expect(result.minimumBarRequirements).toBeDefined();
        expect(result.cultureFit).toBeDefined();
        expect(result.cultureFit.loveFactors).toBeDefined();
        expect(result.cultureFit.hateFactors).toBeDefined();
      });

      it('should return AI-First Lead Product Owner for first skill ID', async () => {
        const session = { skillId: '19100000-0000-0000-0000-000000000000' } as SessionDocument;

        const result = await R2DocumentFetcher.fetch(session);

        expect(result.role).toBe('AI-First Lead Product Owner');
      });

      it('should return AI-Augmented Full-Stack Principal Engineer for second skill ID', async () => {
        const session = { skillId: '89000000-0000-0000-0000-000000000000' } as SessionDocument;

        const result = await R2DocumentFetcher.fetch(session);

        expect(result.role).toBe('AI-Augmented Full-Stack Principal Engineer');
      });
    });

    describe('when skill ID does not exist in pilot', () => {
      it('should throw error for invalid skill ID', async () => {
        const session = { skillId: invalidSkillId } as SessionDocument;

        await expect(R2DocumentFetcher.fetch(session)).rejects.toThrow(
          `R2 document not found for skill ${invalidSkillId}`,
        );
      });

      it('should throw error for undefined skill ID', async () => {
        const session = { skillId: undefined } as any;

        await expect(R2DocumentFetcher.fetch(session)).rejects.toThrow('R2 document not found for skill undefined');
      });
    });
  });
});
