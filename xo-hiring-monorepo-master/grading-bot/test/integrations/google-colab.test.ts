import { getFileIdFromUrl } from '../../src/integrations/google-colab';
import { NonRetryableError } from '../../src/common/non-retryable-error';

describe('GoogleColab', () => {
  describe('getFileIdFromUrl', () => {
    it('should extract file ID from valid Google Colab notebook URL', () => {
      // Arrange
      const validUrl = 'https://colab.research.google.com/drive/1owWnMBv0_vWUgwSMEGN8kk0U4T1Qyo_-?usp=drive_link';
      const expectedFileId = '1owWnMBv0_vWUgwSMEGN8kk0U4T1Qyo_-';

      // Act
      const result = getFileIdFromUrl(validUrl);

      // Assert
      expect(result).toBe(expectedFileId);
    });

    it('should extract file ID from valid Google Drive file URL', () => {
      // Arrange
      const validUrl =
        'https://colab.research.google.com/drive/1ycqUn_QBMdJiM5gQwkUO73pfVfWRJIIT#scrollTo=BgY7VswjZ1s_&uniqifier=1';
      const expectedFileId = '1ycqUn_QBMdJiM5gQwkUO73pfVfWRJIIT';

      // Act
      const result = getFileIdFromUrl(validUrl);

      // Assert
      expect(result).toBe(expectedFileId);
    });

    it('should extract file ID from valid Google Drive notebook URL', () => {
      // Arrange
      const validUrl = 'https://drive.google.com/notebook/d/1abcdefghijklmnopqrstuvwxyz123456/edit';
      const expectedFileId = '1abcdefghijklmnopqrstuvwxyz123456';

      // Act
      const result = getFileIdFromUrl(validUrl);

      // Assert
      expect(result).toBe(expectedFileId);
    });

    it('should throw NonRetryableError for invalid Google Colab URL', () => {
      // Arrange
      const invalidUrl = 'https://example.com/not-a-google-colab';

      // Act & Assert
      expect(() => getFileIdFromUrl(invalidUrl)).toThrow(NonRetryableError);
    });

    it('should throw NonRetryableError for null or undefined URL', () => {
      // Act & Assert
      expect(() => getFileIdFromUrl(null as any)).toThrow(NonRetryableError);

      expect(() => getFileIdFromUrl(undefined as any)).toThrow(NonRetryableError);
    });

    it('should throw NonRetryableError if file ID cannot be extracted', () => {
      // Arrange
      const invalidUrl = 'https://colab.research.google.com/drive/';

      // Act & Assert
      expect(() => getFileIdFromUrl(invalidUrl)).toThrow(NonRetryableError);
    });
  });
});
