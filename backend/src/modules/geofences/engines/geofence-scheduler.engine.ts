export interface GeofenceSchedule {
  /** e.g. ['mon','tue','wed','thu','fri'] - empty/absent means every day */
  days?: string[];
  /** 24h "HH:mm" */
  startTime?: string;
  endTime?: string;
  timezone?: string;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Pure function so GeofenceCheckerEngine can filter to "currently scheduled"
 * geofences before running the (heavier) point-in-polygon check. Timezone
 * handling is intentionally simple (uses server-local time via Date) - swap
 * in a proper tz library (e.g. luxon, already a dependency) if your org
 * spans multiple timezones per fleet.
 */
export function isGeofenceScheduledNow(schedule: GeofenceSchedule | undefined, now: Date = new Date()): boolean {
  if (!schedule) return true;

  if (schedule.days?.length) {
    const today = DAY_KEYS[now.getDay()];
    if (!schedule.days.includes(today)) return false;
  }

  if (schedule.startTime && schedule.endTime) {
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = schedule.startTime.split(':').map(Number);
    const [endH, endM] = schedule.endTime.split(':').map(Number);
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    return start <= end ? minutesNow >= start && minutesNow <= end : minutesNow >= start || minutesNow <= end;
  }

  return true;
}
