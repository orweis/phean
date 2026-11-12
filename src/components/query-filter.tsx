"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { ToolbarSelect } from "./ui/toolbar-select";

interface QueryFilterProps {
  /** The query parameter the filter sets, e.g. `goal`. */
  name: string;
  /** The capsule's visible label, "Goal". */
  label: string;
  /** Names the control for screen readers, "Filter by goal". */
  description: string;
  /** The value that means "no filter", which is left out of the URL. */
  empty?: string;
  /** Query parameters a change of this filter resets, such as a page of results. */
  resets?: readonly string[];
  className?: string;
  children: ReactNode;
}

/** A toolbar filter held in the URL: picking an option navigates to the same page with `?name=value`. */
export function QueryFilter({ name, label, description, empty = "", resets = [], className, children }: QueryFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <ToolbarSelect
      label={label}
      aria-label={description}
      className={className}
      value={params.get(name) ?? empty}
      onChange={(event) => {
        const next = new URLSearchParams(params);
        for (const reset of resets) next.delete(reset);
        if (event.target.value && event.target.value !== empty) next.set(name, event.target.value);
        else next.delete(name);
        const query = next.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
      }}
    >
      {children}
    </ToolbarSelect>
  );
}
