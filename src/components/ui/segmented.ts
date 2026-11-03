import { cx } from "@/lib/cx";

/** A row of mutually exclusive options (time windows, tabs, a Task/Goal switch). */
export const SEGMENTED = "flex rounded-full bg-fill p-0.5";

const SEGMENT = "rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-(--dur-micro)";

/** One option; the selected one is raised out of the track, as in a native segmented control. */
export function segment(selected: boolean): string {
  return cx(SEGMENT, selected ? "bg-raised text-ink shadow-raised" : "text-ink-2 hover:text-ink");
}

/** An option that is a label around a visually hidden radio, selected by `:has(:checked)` without JavaScript. */
export const RADIO_SEGMENT = cx(
  SEGMENT,
  "relative flex-1 cursor-pointer text-center text-ink-2 hover:text-ink has-checked:bg-raised has-checked:text-ink has-checked:shadow-raised",
  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
);
