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
  return dateFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

/** Today's calendar date in UTC, matching how the database compares due dates. */
export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isPastDue(dueDate: string | null, now = new Date()): boolean {
  return dueDate !== null && dueDate < todayIso(now);
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
