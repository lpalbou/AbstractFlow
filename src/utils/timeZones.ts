/**
 * Time zones in words: sentences name the city ("Every day at 08:00
 * (Paris)"), never the raw id. Flow no longer edits schedules (operator
 * ruling 2026-10-25: set in Observer or the Assistant); this names the clock
 * of a schedule saved by an older flow.
 */

/** The place a zone is named after: "Europe/Paris" -> "Paris", "America/New_York" -> "New York". */
export function zoneCity(zone: string): string {
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  const last = zone.split('/').pop() || zone;
  return last.replace(/_/g, ' ');
}
