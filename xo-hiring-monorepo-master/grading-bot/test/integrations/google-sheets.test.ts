import { GoogleSheets } from '../../src/integrations/google-sheets';
import { NonRetryableError } from '../../src/common/non-retryable-error';

describe('GoogleSheets', () => {
  describe('extractSpreadsheetId', () => {
    it('should extract spreadsheet ID from valid Google Sheets URL', () => {
      // Arrange
      const validUrl =
        'https://docs.google.com/spreadsheets/d/12sx3klxsXttjh-ImhxP_mYMBZ_yXWoxaszA2G5kb9jw/edit?usp=sharing';
      const expectedSpreadsheetId = '12sx3klxsXttjh-ImhxP_mYMBZ_yXWoxaszA2G5kb9jw';

      // Act
      const result = GoogleSheets.extractSpreadsheetId(validUrl);

      // Assert
      expect(result).toBe(expectedSpreadsheetId);
    });

    it('should extract spreadsheet ID from valid Google Sheets URL with url params', () => {
      // Arrange
      const validUrl =
        'https://docs.google.com/spreadsheets/d/1kGtTPaw6Jxs4zdzzznqzKLHjwmxhQmhO/dit?usp=sharing&ouid=109297606204070793397&rtpof=true&sd=true';
      const expectedSpreadsheetId = '1kGtTPaw6Jxs4zdzzznqzKLHjwmxhQmhO';

      // Act
      const result = GoogleSheets.extractSpreadsheetId(validUrl);

      // Assert
      expect(result).toBe(expectedSpreadsheetId);
    });

    it('should throw NonRetryableError for invalid Google Sheets URL', () => {
      // Arrange
      const invalidUrl = 'https://example.com/not-a-google-sheet';

      // Act & Assert
      expect(() => GoogleSheets.extractSpreadsheetId(invalidUrl)).toThrow(NonRetryableError);
    });

    it('should throw NonRetryableError for null or undefined URL', () => {
      // Act & Assert
      expect(() => GoogleSheets.extractSpreadsheetId(null as any)).toThrow(NonRetryableError);

      expect(() => GoogleSheets.extractSpreadsheetId(undefined as any)).toThrow(NonRetryableError);
    });

    it('should throw NonRetryableError if spreadsheet ID cannot be extracted', () => {
      // Arrange
      const invalidUrl = 'https://docs.google.com/spreadsheets/d//edit';

      // Act & Assert
      expect(() => GoogleSheets.extractSpreadsheetId(invalidUrl)).toThrow(NonRetryableError);
    });
  });
});
