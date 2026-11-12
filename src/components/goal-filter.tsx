"use client";

import { GoalOptions, type GoalOption } from "./goal-options";
import { QueryFilter } from "./query-filter";

/** Filters the current page by goal through the `?goal=` query parameter. */
export function GoalFilter({ goals }: { goals: readonly GoalOption[] }) {
  return (
    <QueryFilter name="goal" label="Goal" description="Filter by goal" className="w-64 max-sm:w-full">
      <option value="">All goals</option>
      <GoalOptions goals={goals} />
    </QueryFilter>
  );
}
