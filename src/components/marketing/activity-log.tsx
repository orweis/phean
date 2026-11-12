import { Check } from "lucide-react";

import { ActorAvatar } from "@/components/ui/avatar";
import { cx } from "@/lib/cx";

export type ActivityStation = "inbox" | "wait" | "move" | "done";

export interface ActivityEntry {
  time: string;
  who: string;
  type: "agent" | "user";
  station: ActivityStation;
  text: string;
  /** A decision's options, with the one the person picked. */
  options?: { label: string; picked?: boolean }[];
}

/** The station hues of the ledger, so each line reads the way it would on the board; the words carry it too. */
const DOT: Record<ActivityStation, { fill: string; label: string }> = {
  inbox: { fill: "bg-station-inbox", label: "Captured" },
  wait: { fill: "bg-signal", label: "Waiting on a person" },
  move: { fill: "bg-station-progress", label: "In motion" },
  done: { fill: "bg-station-done", label: "Done" },
};

/**
 * A day of work as the overview's activity shows it: when, who (agent tile or person disc), what,
 * and a decision's options drawn inline. Used by the marketing site's stories; all of it is sample data.
 */
export function ActivityLog({ entries, label }: { entries: readonly ActivityEntry[]; label: string }) {
  return (
    <div className="relative">
      <span aria-hidden className="absolute top-3 bottom-3 left-[5rem] w-px -translate-x-1/2 bg-rule" />
      <ol aria-label={label}>
        {entries.map(({ time, who, type, station, text, options }) => (
          <li key={`${time}:${text}`} className="relative grid grid-cols-[3.5rem_1.5rem_minmax(0,1fr)] gap-x-3 py-2.5">
            <time className="figure pt-0.5 text-sm text-muted">{time}</time>
            <span aria-hidden className="flex justify-center pt-2">
              <span className={cx("size-2.5 rounded-full ring-4 ring-panel", DOT[station].fill)} />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <ActorAvatar type={type} className="mt-0" />
                {who}
                <span className="sr-only">{`, ${DOT[station].label.toLowerCase()}`}</span>
              </p>
              <p className="mt-1 text-sm text-ink-2">{text}</p>
              {options && (
                <ul aria-label="Options" className="mt-2 flex flex-wrap gap-1.5">
                  {options.map(({ label: option, picked }) => (
                    <li
                      key={option}
                      className={cx(
                        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
                        picked ? "bg-accent-tint text-accent-ink ring-2 ring-accent ring-inset" : "bg-fill text-ink-2",
                      )}
                    >
                      {picked && <Check aria-hidden className="size-3.5" />}
                      {option}
                      {picked && <span className="sr-only">(picked)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
