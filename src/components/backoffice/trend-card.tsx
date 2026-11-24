import type { ReactNode } from "react";

import { WeekBars } from "@/components/charts/week-bars";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { describeChange, type DayWindow } from "@/lib/backoffice";
import { cx } from "@/lib/cx";

const CHANGE_TONES = { success: "text-arrive-ink", warning: "text-wait-ink" } as const;

interface TrendCardProps {
  title: string;
  /** What the figure counts, exactly: shown behind the (?) beside the title. */
  definition: ReactNode;
  windows: readonly DayWindow[];
  values: readonly (number | null)[];
  format?: (value: number) => string;
  /** Replaces the comparison with the week before, for figures where a change says little (a median). */
  note?: ReactNode;
}

/**
 * A KPI with its trend: this week's figure, how it compares with the week before (always in words,
 * the tone only a second cue), and the twelve weeks as bars.
 */
export function TrendCard({ title, definition, windows, values, format = String, note }: TrendCardProps) {
  const current = values.at(-1) ?? null;
  const previous = values.at(-2) ?? null;
  const change = current !== null && previous !== null ? describeChange(current, previous) : null;
  return (
    <Card className="flex flex-col px-5 pt-4 pb-3">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <InfoTip about={title}>{definition}</InfoTip>
      </div>
      <p className="figure mt-1 text-2xl font-bold text-ink">{current === null ? "None" : format(current)}</p>
      <p className={cx("text-xs", change?.tone && !note ? CHANGE_TONES[change.tone as keyof typeof CHANGE_TONES] : "text-muted")}>
        {note ?? change?.text ?? "Nothing the week before"}
      </p>
      <WeekBars label={title} windows={windows} values={values} format={format} className="mt-3" />
    </Card>
  );
}
