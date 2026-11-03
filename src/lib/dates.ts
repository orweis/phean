/**
 * Calendar arithmetic in UTC days, matching how the database compares due dates
 * (`current_date` on a UTC server). Dates on the wire are YYYY-MM-DD strings. Client-safe.
 */

export const DAY_MS = 86_400_000;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Parses a YYYY-MM-DD date as the start of that UTC day. */
export function dayOf(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** The UTC calendar date of a moment, as YYYY-MM-DD. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayIso(now = new Date()): string {
  return isoDate(now);
}

/** The UTC calendar date `offset` days from today (negative is in the past). */
export function isoDayFromToday(offset: number, now = new Date()): string {
  return isoDate(addDays(now, offset));
}

/** Whole days between two calendar dates, positive when `to` is later. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS);
}

export function isPastDue(dueDate: string | null, now = new Date()): boolean {
  return dueDate !== null && dueDate < todayIso(now);
}
