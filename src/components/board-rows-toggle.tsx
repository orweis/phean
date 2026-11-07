"use client";

import { Rows2, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useId } from "react";

import { cx } from "@/lib/cx";
import { BOARD_ROWS, boardRowsCookie, type BoardRows } from "@/lib/swimlanes";

import { RADIO_SEGMENT, SEGMENTED } from "./ui/segmented";

const OPTIONS: Record<BoardRows, { label: string; Icon: typeof Rows2 }> = {
  split: { label: "People and agents", Icon: Rows2 },
  single: { label: "One row", Icon: Square },
};

/** Saves the choice for the server, which renders every later visit of the board with it. */
function saveRows(rows: BoardRows) {
  document.cookie = boardRowsCookie(rows, location.protocol === "https:");
}

/**
 * Splits the board into its People and Agents rows, or shows each lane as one list. The choice is a
 * cookie, so the server renders every later visit the same way; the switch redraws the page at once.
 */
export function BoardRowsToggle({ rows }: { rows: BoardRows }) {
  const router = useRouter();
  const name = useId();
  const choose = (next: BoardRows) => {
    saveRows(next);
    startTransition(() => router.refresh());
  };
  return (
    <fieldset>
      <legend className="sr-only">Board rows</legend>
      <div className={cx(SEGMENTED, "h-9 items-center")}>
        {BOARD_ROWS.map((value) => {
          const { label, Icon } = OPTIONS[value];
          return (
            <label key={value} className={cx(RADIO_SEGMENT, "inline-flex items-center gap-1.5 whitespace-nowrap")} title={label}>
              <input type="radio" name={name} value={value} defaultChecked={value === rows} onChange={() => choose(value)} className="sr-only" />
              <Icon className="size-3.5" aria-hidden />
              <span className="max-sm:sr-only">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
