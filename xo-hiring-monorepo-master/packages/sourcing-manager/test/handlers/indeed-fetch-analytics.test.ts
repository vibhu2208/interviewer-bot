import { DateTime } from 'luxon';
import { JobAnalytics } from '../../src/integrations/indeed';
import { processWeeklyAnalytics } from '../../src/handlers/indeed-fetch-analytics';

describe('IndeedFetchAnalytics', () => {
  describe('processWeeklyAnalytics', () => {
    test('correctly processes analytics with ISO week numbers #1', () => {
      // Setup
      const weekStart = DateTime.fromISO('2024-12-25');
      const mockAnalytics: JobAnalytics[] = [{ sumCostLocal: 100, jobReferenceNumber: '1' }] as any;

      // Action
      const result = processWeeklyAnalytics(mockAnalytics, weekStart);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        ...mockAnalytics[0],
        weekNum: '2024-52',
        weekDate: '2024-12-23',
        sourcingWeekDate: '2024-12-25',
      });
    });

    test('correctly processes analytics with ISO week numbers #2', () => {
      // Setup
      const weekStart = DateTime.fromISO('2025-01-01');
      const mockAnalytics: JobAnalytics[] = [{ sumCostLocal: 100, jobReferenceNumber: '1' }] as any;

      // Action
      const result = processWeeklyAnalytics(mockAnalytics, weekStart);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        ...mockAnalytics[0],
        weekNum: '2025-01',
        weekDate: '2024-12-30',
        sourcingWeekDate: '2025-01-01',
      });
    });
  });
});
