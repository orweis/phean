"use client";

import { TASK_STATUSES, TASK_STATUS_META } from "@/lib/domain";
import { STATUS_FILTER_LABELS } from "@/lib/task-views";

import { QueryFilter } from "./query-filter";

/** Which tasks the Tasks page's table, calendar and map list, through `?status=`; open ones by default. */
export function StatusFilter() {
  return (
    <QueryFilter name="status" label="Status" description="Filter by status" empty="open" className="w-48 max-sm:w-full">
      <option value="open">{STATUS_FILTER_LABELS.open}</option>
      <option value="all">{STATUS_FILTER_LABELS.all}</option>
      {TASK_STATUSES.map((status) => (
        <option key={status} value={status}>
          {TASK_STATUS_META[status].label}
        </option>
      ))}
    </QueryFilter>
  );
}
