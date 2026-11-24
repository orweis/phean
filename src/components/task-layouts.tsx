import { CalendarDays, KanbanSquare, Network, Table2 } from "lucide-react";

import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";
import { carriedFilters, TASK_LAYOUT_META, TASK_LAYOUTS, type TaskLayout, type TaskQuery } from "@/lib/task-views";

import { TrackedLink } from "./tracked-link";
import { ChipRail } from "./ui/chip-rail";
import { segment, SEGMENTED } from "./ui/segmented";

const ICONS: Record<TaskLayout, typeof KanbanSquare> = { board: KanbanSquare, table: Table2, calendar: CalendarDays, map: Network };

/**
 * Board, Table, Calendar and Map: one segmented control of links, so each layout has its own URL
 * and keeps the goal, agent and status filters. The board is the default and has no `?view=`.
 */
export function TaskLayoutSwitcher({ slug, layout, query }: { slug: string; layout: TaskLayout; query: TaskQuery }) {
  const kept = carriedFilters(query);
  return (
    <ChipRail label="Task layout" selected={layout} className={cx(SEGMENTED, "w-fit max-w-full")}>
      {TASK_LAYOUTS.map((key) => {
        const Icon = ICONS[key];
        return (
          <TrackedLink
            key={key}
            href={routes.board(slug, { ...kept, view: key === "board" ? undefined : key })}
            analytics={key === layout ? undefined : { event: "tasks_layout", params: { layout: key } }}
            aria-current={key === layout ? "page" : undefined}
            title={TASK_LAYOUT_META[key].hint}
            className={cx(segment(key === layout), "inline-flex items-center gap-1.5 whitespace-nowrap")}
          >
            <Icon aria-hidden className="size-3.5" />
            {TASK_LAYOUT_META[key].label}
          </TrackedLink>
        );
      })}
    </ChipRail>
  );
}
