"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { GoalOptions, type GoalOption } from "./goal-options";
import { ToolbarSelect } from "./ui/toolbar-select";

/** Filters the current page by goal through the `?goal=` query parameter. */
export function GoalFilter({ goals }: { goals: readonly GoalOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <ToolbarSelect
      label="Goal"
      aria-label="Filter by goal"
      className="w-64 max-sm:w-full"
      value={params.get("goal") ?? ""}
      onChange={(event) => {
        const next = new URLSearchParams(params);
        if (event.target.value) next.set("goal", event.target.value);
        else next.delete("goal");
        const query = next.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
      }}
    >
      <option value="">All goals</option>
      <GoalOptions goals={goals} />
    </ToolbarSelect>
  );
}
