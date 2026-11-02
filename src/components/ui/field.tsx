import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

const CONTROL =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-xs placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100 focus:outline-none disabled:bg-zinc-50";

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
      <label htmlFor={htmlFor} className="block text-xs font-medium text-zinc-700">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
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
