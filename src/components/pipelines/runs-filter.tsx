"use client";

import { QueryFilter } from "../query-filter";

/** Which runs a list shows, held in the URL (`runs`): all of them, or those with a stop no one picked up. */
export function RunsFilter({ stuck }: { stuck: number }) {
  return (
    <QueryFilter name="runs" label="Runs" analytics={{ event: "filter_apply", params: { filter: "stuck" } }} description="Filter runs" className="w-40">
      <option value="">All runs</option>
      <option value="stuck">Stuck ({stuck})</option>
    </QueryFilter>
  );
}
