"use client";

import { CalendarClock, X } from "lucide-react";
import { useState } from "react";

import { cx } from "@/lib/cx";
import { formatDueDate } from "@/lib/format";

interface DateInputProps {
  id: string;
  name: string;
  defaultValue?: string | null;
  /** What an empty value reads as, e.g. "No due date". */
  empty: string;
}

/**
 * A calendar date shown the way cards show it ("Nov 7"), with the browser's own picker behind it,
 * so a person never sees two formats for one date. Clearing posts an empty value.
 */
export function DateInput({ id, name, defaultValue, empty }: DateInputProps) {
  const [value, setValue] = useState(defaultValue ?? "");
  return (
    <div className="relative">
      <div
        className={cx(
          "flex h-9 items-center gap-2 rounded-md border border-edge bg-panel px-3 text-sm hover:border-ink-2",
          "has-focus-visible:border-focus has-focus-visible:outline-3 has-focus-visible:outline-focus/30",
          value ? "text-ink" : "text-muted",
        )}
      >
        <CalendarClock className="size-4 shrink-0 text-muted" aria-hidden />
        <span aria-hidden className="min-w-0 flex-1 truncate">
          {value ? formatDueDate(value) : empty}
        </span>
        <input
          id={id}
          name={name}
          type="date"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onClick={(event) => event.currentTarget.showPicker?.()}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </div>
      {value && (
        <button
          type="button"
          aria-label={`Clear ${formatDueDate(value)}`}
          onClick={() => setValue("")}
          className="absolute top-1/2 right-1 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
