import { addDays, dayOf, isoDate, todayIso } from "./dates";

/** A month as the calendar shows it: whole weeks, Monday first, in UTC days like every due date. */
export interface MonthGrid {
  /** YYYY-MM. */
  month: string;
  /** "November 2026". */
  title: string;
  /** Weeks of seven YYYY-MM-DD days, padded with the neighbouring months' days. */
  weeks: string[][];
  previous: string;
  next: string;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The month a `?month=` value names, or the current one when it is missing or malformed. */
export function parseMonth(value: string | undefined, now = new Date()): string {
  return value && MONTH.test(value) ? value : todayIso(now).slice(0, 7);
}

function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split("-").map(Number) as [number, number];
  return isoDate(new Date(Date.UTC(year, index - 1 + by, 1))).slice(0, 7);
}

export function monthGrid(month: string): MonthGrid {
  const first = dayOf(`${month}-01`);
  // getUTCDay is 0 for Sunday; Monday starts the week.
  const start = addDays(first, -((first.getUTCDay() + 6) % 7));
  const following = dayOf(`${shiftMonth(month, 1)}-01`);
  const weeks: string[][] = [];
  for (let day = start; day < following || weeks.at(-1)?.length !== 7; day = addDays(day, 1)) {
    if (!weeks.length || weeks.at(-1)!.length === 7) weeks.push([]);
    weeks.at(-1)!.push(isoDate(day));
  }
  return {
    month,
    title: first.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
    weeks,
    previous: shiftMonth(month, -1),
    next: shiftMonth(month, 1),
  };
}

/** The first and last day the grid shows, for asking the database only for those. */
export function gridRange(grid: MonthGrid): { from: string; to: string } {
  return { from: grid.weeks[0]![0]!, to: grid.weeks.at(-1)!.at(-1)! };
}

/** Tasks by their due day; tasks without one are left out (the calendar counts them separately). */
export function byDueDay<T extends { dueDate: string | null }>(tasks: readonly T[]): Map<string, T[]> {
  const days = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    days.set(task.dueDate, [...(days.get(task.dueDate) ?? []), task]);
  }
  return days;
}
