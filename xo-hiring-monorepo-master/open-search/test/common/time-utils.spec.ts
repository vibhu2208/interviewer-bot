import { TimeUtils } from '../../src/common/time-utils';

describe('getTimezoneOffsetToUTCNoDST', () => {
  const matrix: [string, number | null][] = [
    ['Invalid', null],
    ['Europe/Belgrade', 60],
    ['America/Chicago', -360],
    ['Australia/Lord_Howe', 630],
  ];

  test.each(matrix)('given timezone %p, returns offset %p', (timezone, offset) => {
    const result = TimeUtils.getTimezoneOffsetToUTCNoDST(timezone);

    expect(result).toBe(offset);
  });
});

describe('convertTimezoneHourToUTCNoDST', () => {
  const matrix: [string, number, number][] = [
    ['Invalid', 7, 7],
    ['Europe/Belgrade', 7, 6],
    ['America/Chicago', 6, 12],
    ['Australia/Lord_Howe', 3, 16],
  ];

  test.each(matrix)('given timezone %p, hour %p, returns hour %p', (timezone, hour, adjusted) => {
    const result = TimeUtils.convertTimezoneHourToUTCNoDST(hour, timezone);

    expect(result).toBe(adjusted);
  });
});
