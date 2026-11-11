"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * A row that opens a panel beneath it, for lists whose rows hold their own links (a `<details>`
 * summary may not). The toggle reads as it looks ("3 open tasks"), with what it belongs to added for
 * screen readers ("in Close the quarter"), and carries `aria-expanded`; the panel renders only while open.
 */
export function ExpandableRow({
  header,
  panel,
  subject,
  count,
  className,
}: {
  header: ReactNode;
  panel: ReactNode;
  /** What the row is, added to the toggle's name for screen readers: "in Close the quarter". */
  subject: string;
  /** The visible part of the toggle, such as "5 tasks". */
  count: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {header}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className={cx(
            "relative inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold after:absolute after:-inset-1.5",
            open ? "bg-fill text-ink" : "text-ink-2 hover:bg-fill hover:text-ink",
          )}
        >
          {count}
          <span className="sr-only"> {subject}</span>
          <ChevronDown aria-hidden className={cx("size-4 transition-transform duration-(--dur-micro)", open && "rotate-180")} />
        </button>
      </div>
      <div id={id} hidden={!open}>
        {open && panel}
      </div>
    </div>
  );
}
