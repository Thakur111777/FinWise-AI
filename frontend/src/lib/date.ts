/**
 * ISO-8601 (YYYY-MM-DD) date helpers for the Financial Core.
 *
 * Transaction dates are stored as plain YYYY-MM-DD strings and compared
 * lexicographically — no timezone-dependent `Date` parsing in domain logic.
 */

export interface ISODateParts {
  year: number;
  month: number;
  day: number;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function parseISODate(value: string): ISODateParts | null {
  if (!isValidISODate(value)) return null;
  const match = ISO_DATE_PATTERN.exec(value)!;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function partsToISODate(parts: ISODateParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Convert a local `Date` to a YYYY-MM-DD string in the local timezone. */
export function toISODate(date: Date): string {
  return partsToISODate({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

export function todayISODate(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const parts = parseISODate(iso);
  if (!parts) return iso;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Add whole months while clamping the day to the target month's length. */
export function addMonthsClamped(iso: string, months: number): string {
  const parts = parseISODate(iso);
  if (!parts) return iso;
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return partsToISODate({ year, month, day: Math.min(parts.day, lastDay) });
}

export function addYears(iso: string, years: number): string {
  const parts = parseISODate(iso);
  if (!parts) return iso;
  const year = parts.year + years;
  const lastDay = new Date(Date.UTC(year, parts.month, 0)).getUTCDate();
  return partsToISODate({ year, month: parts.month, day: Math.min(parts.day, lastDay) });
}

/** Human-friendly display formatting. Falls back to the raw string when invalid. */
export function formatHumanDate(value: string): string {
  const parts = parseISODate(value);
  if (!parts) return value;
  const date = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}