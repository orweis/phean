import { dayOf, daysBetween } from "./dates";

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return "never";
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** Formats a YYYY-MM-DD calendar date without shifting it across time zones. */
export function formatDueDate(isoDate: string): string {
  return dateFormat.format(dayOf(isoDate));
}

/** "Nov 3" for a moment, read as a UTC calendar day like due dates are. */
export function formatDay(date: Date): string {
  return dateFormat.format(date);
}

/** "Today", "Tomorrow", "In 3 days" or "2 days late", counted in UTC calendar days. */
export function relativeDue(isoDate: string, now = new Date()): string {
  const days = daysBetween(now, dayOf(isoDate));
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return days > 0 ? `In ${days} days` : `${pluralize(-days, "day")} late`;
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
