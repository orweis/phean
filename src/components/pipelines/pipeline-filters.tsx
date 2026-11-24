"use client";

import { PIPELINE_KIND_META, PIPELINE_STATUS_META, PIPELINE_STATUSES, DEFINABLE_PIPELINE_KINDS } from "@/lib/domain";

import { QueryFilter } from "../query-filter";

/** The Pipelines tab's filters, held in the URL: kind and status (archived ones only when asked for). */
export function PipelineFilters() {
  return (
    <>
      <QueryFilter name="kind" label="Kind" analytics={{ event: "filter_apply", params: { filter: "kind" } }} description="Filter by kind" className="w-36">
        <option value="">All kinds</option>
        {DEFINABLE_PIPELINE_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {PIPELINE_KIND_META[kind].label}
          </option>
        ))}
      </QueryFilter>
      <QueryFilter name="status" label="Status" analytics={{ event: "filter_apply", params: { filter: "status" } }} description="Filter by status" className="w-40">
        <option value="">Active and paused</option>
        {PIPELINE_STATUSES.map((status) => (
          <option key={status} value={status}>
            {PIPELINE_STATUS_META[status].label}
          </option>
        ))}
      </QueryFilter>
    </>
  );
}
