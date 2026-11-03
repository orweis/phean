import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

/** Controls fill their container (class order cannot override `w-full`), so size the wrapper instead. */
const CONTROL =
  "w-full rounded-md border border-edge bg-panel px-3 text-sm text-ink placeholder:text-muted hover:border-ink-2 " +
  "transition-[border-color,outline-color] duration-(--dur-micro) " +
  "focus:border-focus focus:outline-3 focus:outline-offset-0 focus:outline-focus/30 " +
  "disabled:cursor-not-allowed disabled:bg-fill disabled:text-muted";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(CONTROL, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(CONTROL, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(CONTROL, "h-9 pr-8", className)} {...props} />;
}

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, children, className }: FieldProps) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Options for a domain enum, labelled through its metadata table. */
export function enumOptions<K extends string>(values: readonly K[], meta: Record<K, { label: string }>) {
  return values.map((value) => (
    <option key={value} value={value}>
      {meta[value].label}
    </option>
  ));
}
