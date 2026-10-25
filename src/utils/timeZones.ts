/**
 * Time zones in words (UX re-review #11): a short list of cities with their
 * UTC offset ("Paris (UTC+1)", "New York (UTC−4)"), the person's own zone
 * first; every other IANA zone is found by search. Sentences name the city
 * ("Every day at 08:00 (Paris)"), never the raw id.
 */

export const CURATED_ZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Mexico_City',
  'America/Bogota',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Atlantic/Reykjavik',
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Zurich',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
];

/** The place a zone is named after: "Europe/Paris" -> "Paris", "America/New_York" -> "New York". */
export function zoneCity(zone: string): string {
  if (zone === 'UTC' || zone === 'Etc/UTC') return 'UTC';
  const last = zone.split('/').pop() || zone;
  return last.replace(/_/g, ' ');
}

/** "UTC+1", "UTC−4", "UTC+5:30" at `at` (now by default); "" when the zone is unknown here. */
export function zoneOffset(zone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!part) return '';
    const m = /GMT([+-])?(\d{1,2})?(?::(\d{2}))?/.exec(part);
    if (!m || !m[1] || (!Number(m[2]) && (!m[3] || m[3] === '00'))) return 'UTC';
    return `UTC${m[1] === '-' ? '−' : '+'}${Number(m[2])}${m[3] && m[3] !== '00' ? `:${m[3]}` : ''}`;
  } catch {
    return '';
  }
}

/** "Paris (UTC+1)". */
export function zoneLabel(zone: string, at?: Date): string {
  const offset = zoneOffset(zone, at);
  const city = zoneCity(zone);
  return offset && offset !== city ? `${city} (${offset})` : city;
}

function offsetMinutes(zone: string, at: Date): number {
  const o = zoneOffset(zone, at);
  const m = /UTC([+−])(\d+)(?::(\d+))?/.exec(o);
  if (!m) return 0;
  return (m[1] === '−' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/** The picker's short list: the person's zone first, then the curated cities by offset. */
export function zoneChoicesFor(current: string, at: Date = new Date()): Array<{ zone: string; label: string }> {
  const rest = CURATED_ZONES.filter((z) => z !== current).sort((a, b) => offsetMinutes(a, at) - offsetMinutes(b, at));
  return [current, ...rest].map((zone) => ({ zone, label: zoneLabel(zone, at) }));
}
