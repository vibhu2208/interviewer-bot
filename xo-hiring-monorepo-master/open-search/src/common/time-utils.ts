import { DateTime, IANAZone } from 'luxon';

export class TimeUtils {
  static FirstJanuary: DateTime = DateTime.fromISO('2020-01-01T01:01:00', { zone: 'utc' });
  static FirstJuly: DateTime = DateTime.fromISO('2020-07-01T01:01:00', { zone: 'utc' });

  /**
   * Calculate UTC hour for specific timezone without DST
   * @param hour and hour (0 - 24)
   * @param timezone IANA timezone
   * @return hour (0 - 24) in UTC
   */
  static convertTimezoneHourToUTCNoDST(hour: number, timezone: string): number {
    const timezoneOffset = TimeUtils.getTimezoneOffsetToUTCNoDST(timezone) ?? 0;

    // Treating time as UTC and directly subtracting timezone offset
    return TimeUtils.FirstJanuary.set({ hour }).minus({ minute: timezoneOffset }).hour;
  }

  /**
   * Calculate timezone offset in minutes without DST
   * @param timezone IANA timezone name
   * @return offset from UTC time in minutes or null if timezone is not valid
   */
  static getTimezoneOffsetToUTCNoDST(timezone: string | null | undefined): number | null {
    if (!timezone) {
      return null;
    }

    if (!IANAZone.isValidZone(timezone)) {
      return null;
    }

    // The minimal UTC offset across January and July should be an SDT offset
    return Math.min(TimeUtils.FirstJanuary.setZone(timezone).offset, TimeUtils.FirstJuly.setZone(timezone).offset);
  }
}
