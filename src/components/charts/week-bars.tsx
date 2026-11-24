import { barFractions, windowLabel, type DayWindow } from "@/lib/backoffice";
import { cx } from "@/lib/cx";

interface WeekBarsProps {
  /** What the bars count, for the table screen readers read ("New signups"). */
  label: string;
  windows: readonly DayWindow[];
  /** One value per window, oldest first; null where there is nothing to show (a median of nothing). */
  values: readonly (number | null)[];
  /** How a value reads in the table and on hover. */
  format?: (value: number) => string;
  /** How a window is named on the axis and in the table; weeks by default ("18–24 Nov"). */
  labelOf?: (window: DayWindow) => string;
  /** What one bar is, for the table's first column ("Week", "Day"). */
  unit?: string;
  className?: string;
}

/**
 * Twelve trailing weeks as server-rendered bars: heights are fractions of the largest week
 * (`barFractions`), the latest week in the brand and the others a wash of it, each with its figure
 * on hover. A visually hidden table says every week's figure, so the chart never relies on its shape.
 */
export function WeekBars({ label, windows, values, format = String, labelOf = windowLabel, unit = "Week", className }: WeekBarsProps) {
  const fractions = barFractions(values.map((value) => value ?? 0));
  const last = values.length - 1;
  return (
    <div className={cx("min-w-0", className)}>
      <div aria-hidden className="flex h-16 items-end gap-0.5 sm:gap-1" data-chart="week-bars">
        {fractions.map((fraction, index) => (
          <span
            key={windows[index]!.to}
            title={`${labelOf(windows[index]!)}: ${values[index] === null ? "none" : format(values[index]!)}`}
            data-segment={windows[index]!.to}
            className={cx("min-h-px flex-1 rounded-t-xs", index === last ? "bg-accent" : "bg-accent/35", values[index] === null && "bg-rule")}
            style={{ height: `${Math.max(fraction * 100, 2)}%` }}
          />
        ))}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-2xs text-muted">
        <span>{labelOf(windows[0]!)}</span>
        <span>{labelOf(windows[last]!)}</span>
      </div>
      <table className="sr-only">
        <caption>{`${label}, per ${unit.toLowerCase()}, oldest first`}</caption>
        <thead>
          <tr>
            <th scope="col">{unit}</th>
            <th scope="col">{label}</th>
          </tr>
        </thead>
        <tbody>
          {windows.map((window, index) => (
            <tr key={window.to}>
              <th scope="row">{labelOf(window)}</th>
              <td>{values[index] === null ? "none" : format(values[index]!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
