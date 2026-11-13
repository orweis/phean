"use client";

import { HANDOFF_FILTER_LABELS, HANDOFF_FILTERS } from "@/lib/task-views";

import { QueryFilter } from "./query-filter";

/** Which handovers the Tasks page shows, through `?handoff=`: every task by default. */
export function HandoffFilter() {
  return (
    <QueryFilter name="handoff" label="Handoff" description="Filter by handoff" empty="all" className="w-52 max-sm:w-full">
      {HANDOFF_FILTERS.map((filter) => (
        <option key={filter} value={filter}>
          {HANDOFF_FILTER_LABELS[filter]}
        </option>
      ))}
    </QueryFilter>
  );
}
