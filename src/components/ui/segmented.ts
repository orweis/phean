import { cx } from "@/lib/cx";

/** A row of mutually exclusive options (time windows, tabs, a Task/Goal switch). */
export const SEGMENTED = "flex rounded-md border border-rule bg-panel p-0.5";

const SEGMENT = "rounded-sm px-2.5 py-1.5 text-xs font-semibold transition-colors duration-(--dur-micro)";

/** One option; the selected one takes the shell navy, as DESIGN.md reserves it for. */
export function segment(selected: boolean): string {
  return cx(SEGMENT, selected ? "bg-shell text-shell-ink" : "text-ink-2 hover:bg-sunken hover:text-ink");
}

/** An option that is a label around a visually hidden radio, selected by `:has(:checked)` without JavaScript. */
export const RADIO_SEGMENT = cx(
  SEGMENT,
  "relative flex-1 cursor-pointer text-center text-ink-2 hover:bg-sunken hover:text-ink has-checked:bg-shell has-checked:text-shell-ink",
  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
);
