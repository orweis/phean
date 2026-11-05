"use client";

import { useState, type ComponentProps } from "react";

import { cx } from "@/lib/cx";

import { Textarea } from "./field";

/** The share of the limit after which the count shows, so it only speaks up when it matters. */
const SHOW_AT = 0.8;

/** A textarea that shows how much room is left once the text nears `maxLength`. */
export function CountedTextarea({ maxLength, id, ...props }: ComponentProps<typeof Textarea> & { maxLength: number; id: string }) {
  const [length, setLength] = useState(String(props.defaultValue ?? "").length);
  const near = length >= maxLength * SHOW_AT;
  return (
    <>
      <Textarea id={id} maxLength={maxLength} aria-describedby={near ? `${id}-count` : undefined} onChange={(event) => setLength(event.target.value.length)} {...props} />
      {near && (
        <p id={`${id}-count`} aria-live="polite" className={cx("text-right text-xs", length >= maxLength ? "font-semibold text-late-ink" : "text-muted")}>
          {length} of {maxLength} characters
        </p>
      )}
    </>
  );
}
