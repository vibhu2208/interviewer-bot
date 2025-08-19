import { GoogleDocs } from '../../src/integrations/google-docs';
import { NonRetryableError } from '../../src/common/non-retryable-error';

describe('GoogleDocs', () => {
  describe('fetchGoogleDocumentContent', () => {
    it('should extract document ID from valid Google Docs URL', async () => {
      // Arrange
      const validUrl = 'https://docs.google.com/document/d/1234567890abcdefghijklmnopqrstuvwxyz/edit';
      const expectedDocumentId = '1234567890abcdefghijklmnopqrstuvwxyz';

      // Mock the getDocumentById method
      GoogleDocs.getDocumentById = jest.fn().mockResolvedValue({ content: 'mocked content' });

      // Act
      await GoogleDocs.fetchGoogleDocumentContent(validUrl);

      // Assert
      expect(GoogleDocs.getDocumentById).toHaveBeenCalledWith(expectedDocumentId);
    });

    it('should throw NonRetryableError for invalid Google Docs URL', async () => {
      // Arrange
      const invalidUrl = 'https://example.com/not-a-google-doc';

      // Act & Assert
      await expect(GoogleDocs.fetchGoogleDocumentContent(invalidUrl)).rejects.toThrow(NonRetryableError);
    });

    it('should throw NonRetryableError for null or undefined URL', async () => {
      // Act & Assert
      await expect(GoogleDocs.fetchGoogleDocumentContent(null)).rejects.toThrow(NonRetryableError);

      await expect(GoogleDocs.fetchGoogleDocumentContent(undefined)).rejects.toThrow(NonRetryableError);
    });

    it('should throw NonRetryableError if document ID cannot be extracted', async () => {
      // Arrange
      const invalidUrl = 'https://docs.google.com/document/d//edit';

      // Act & Assert
      await expect(GoogleDocs.fetchGoogleDocumentContent(invalidUrl)).rejects.toThrow(NonRetryableError);
    });
  });
});
