import { Check } from "lucide-react";

import { ActorAvatar } from "@/components/ui/avatar";
import { cx } from "@/lib/cx";

type Station = "inbox" | "wait" | "move" | "done";

interface Entry {
  time: string;
  who: string;
  type: "agent" | "user";
  station: Station;
  text: string;
  /** A decision's options, with the one the person picked. */
  options?: { label: string; picked?: boolean }[];
}

/** The station hues of the ledger, so each line reads the way it would on the board. */
const DOT: Record<Station, string> = {
  inbox: "bg-station-inbox",
  wait: "bg-signal",
  move: "bg-station-progress",
  done: "bg-station-done",
};

/** A sample morning, in the order the loop runs: capture, propose, approve, claim, ask, answer, done. */
const MORNING: Entry[] = [
  { time: "07:02", who: "Mail clerk", type: "agent", station: "inbox", text: "Captured 6 tasks from the shared inbox, each linked to its email. Skipped 1 that Slack scout already had." },
  { time: "07:06", who: "Slack scout", type: "agent", station: "wait", text: "Proposed the goal “Close the quarter” and filed 4 of the tasks under it." },
  { time: "07:41", who: "You", type: "user", station: "move", text: "Approved “Close the quarter”." },
  { time: "08:15", who: "Finance clerk", type: "agent", station: "move", text: "Claimed “Reconcile November invoices”, with a link back to its Claude session." },
  {
    time: "09:12",
    who: "Finance clerk",
    type: "agent",
    station: "wait",
    text: "Asked you: which card should the software renewal go on? It recommends the company card, since the vendor bills annually.",
    options: [{ label: "Company card", picked: true }, { label: "Team card" }, { label: "Ask the vendor to invoice" }],
  },
  { time: "09:20", who: "You", type: "user", station: "move", text: "Picked “Company card”. The clerk heard it over its webhook and carried on." },
  { time: "10:04", who: "Finance clerk", type: "agent", station: "done", text: "Completed “Reconcile November invoices”: 41 matched, 2 credit notes filed." },
];

/** The loop as one morning's activity log, the way the overview shows it, with the decision drawn inline. */
export function SampleMorning() {
  return (
    <div className="relative">
      <span aria-hidden className="absolute top-3 bottom-3 left-[5rem] w-px -translate-x-1/2 bg-rule" />
      <ol>
      {MORNING.map(({ time, who, type, station, text, options }) => (
        <li key={time} className="relative grid grid-cols-[3.5rem_1.5rem_minmax(0,1fr)] gap-x-3 py-3">
          <time className="figure pt-0.5 text-sm text-muted">{time}</time>
          <span aria-hidden className="flex justify-center pt-2">
            <span className={cx("size-2.5 rounded-full ring-4 ring-paper", DOT[station])} />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ActorAvatar type={type} className="mt-0" />
              {who}
            </p>
            <p className="mt-1 text-sm text-ink-2">{text}</p>
            {options && (
              <ul aria-label="Options" className="mt-2.5 flex flex-wrap gap-1.5">
                {options.map(({ label, picked }) => (
                  <li
                    key={label}
                    className={cx(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
                      picked ? "bg-accent-tint text-accent-ink ring-2 ring-accent ring-inset" : "bg-fill text-ink-2",
                    )}
                  >
                    {picked && <Check aria-hidden className="size-3.5" />}
                    {label}
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
