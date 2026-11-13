import type { Metadata } from "next";
import { Columns3Cog, X } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

import { BoardRowsToggle } from "@/components/board-rows-toggle";
import { GoalFilter } from "@/components/goal-filter";
import { HandoffFilter } from "@/components/handoff-filter";
import { KanbanBoard } from "@/components/kanban-board";
import { ManualEntry } from "@/components/manual-entry";
import { PageHeader } from "@/components/page-header";
import { StatusFilter } from "@/components/status-filter";
import { TaskCalendar } from "@/components/task-calendar";
import { TaskLayoutSwitcher } from "@/components/task-layouts";
import { TaskMap } from "@/components/task-map";
import { TaskTable } from "@/components/task-table";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { gridRange, monthGrid, parseMonth } from "@/lib/calendar";
import { subtreeIds } from "@/lib/goal-tree";
import { queryParam, routes } from "@/lib/routes";
import { BOARD_ROWS_COOKIE, parseBoardRows, type BoardRows } from "@/lib/swimlanes";
import { layoutMap } from "@/lib/task-map";
import { parseTableSort } from "@/lib/task-table";
import { parseHandoffFilter, parseStatusFilter, parseTaskLayout, type TaskLayout, type TaskQuery } from "@/lib/task-views";
import { requireWorkspace } from "@/server/auth/session";
import { listAgents } from "@/server/domain/agents";
import { listGoals, type GoalWithProgress } from "@/server/domain/goals";
import { browseTasks, getBoard } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import type { Ctx } from "@/server/domain/context";
import { orNotFound, workspaceWorkflow } from "@/server/web";

export const metadata: Metadata = { title: "Tasks" };

const DESCRIPTIONS: Record<TaskLayout, (canWrite: boolean) => string> = {
  board: (canWrite) =>
    `Every task by stage, in two rows: People, for work waiting on a person, and Agents, for work agents hold or captured.${canWrite ? " Drag a card to another lane to move it, or use its buttons." : ""} Done shows the 20 most recently completed.`,
  table: () => "Every task as a row. Sort by any column from its heading; open a task from its title. Status picks which tasks are listed: the open ones unless you choose otherwise.",
  calendar: () => "Tasks on the day they are due, a month at a time. Late ones are in red. Tasks without a due date are counted above the calendar.",
  map: () => "Goals, their tasks and those tasks' subtasks as one tree, read left to right. Goals with nothing open under them are left off.",
};

/** Says when a layout shows only the first tasks of more that match, so a cut list never passes for all of them. */
function Partial({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) return null;
  return (
    <p role="note" className="border-b border-rule px-5 py-2.5 text-xs text-muted">
      Showing the {shown} most urgent of {total} tasks. Pick a goal or a status to see the rest.
    </p>
  );
}

/** The layout a request asked for, drawn from the tasks the shared filters select. */
async function Layout({ layout, ctx, slug, query, goals, canWrite, rows }: { layout: TaskLayout; ctx: Ctx; slug: string; query: TaskQuery; goals: GoalWithProgress[]; canWrite: boolean; rows: BoardRows }) {
  const scope = { goalId: query.goal, heldBy: query.agent, status: parseStatusFilter(query.status), handoff: parseHandoffFilter(query.handoff) };
  if (layout === "board") {
    const board = await orNotFound(getBoard(ctx, { goalId: scope.goalId, heldBy: scope.heldBy, handoff: scope.handoff }));
    return <KanbanBoard board={board} slug={slug} canWrite={canWrite} goals={goals} goalId={query.goal} lane={query.lane} rows={rows} />;
  }
  const grid = layout === "calendar" ? monthGrid(parseMonth(query.month)) : null;
  // The calendar asks only for the weeks it shows, and counts what it cannot place.
  const [{ tasks, total }, undated] = await Promise.all([
    orNotFound(browseTasks(ctx, { ...scope, ...(grid ? { dueFrom: gridRange(grid).from, dueTo: gridRange(grid).to } : {}), undated: !grid && query.due === "none" })),
    grid ? browseTasks(ctx, { ...scope, undated: true, limit: 1 }).then((result) => result.total) : 0,
  ]);
  if (!tasks.length && !grid) {
    return (
      <Card>
        <CardBody>
          <EmptyState title="No tasks match">
            Try another status or goal.{" "}
            <Link href={routes.board(slug, { view: layout })} className="font-semibold link">
              Clear the filters
            </Link>
          </EmptyState>
        </CardBody>
      </Card>
    );
  }
  if (grid) {
    return (
      <Card>
        <TaskCalendar grid={grid} tasks={tasks} undated={undated} slug={slug} query={query} />
      </Card>
    );
  }
  if (layout === "table") {
    return (
      <Card>
        <Partial shown={tasks.length} total={total} />
        <TaskTable tasks={tasks} slug={slug} sort={parseTableSort(query.sort, query.dir)} query={query} workflow={await workspaceWorkflow(slug)} />
      </Card>
    );
  }
  const shown = query.goal ? new Set(subtreeIds(goals, query.goal)) : null;
  const layoutGoals = shown ? goals.filter((goal) => shown.has(goal.id)) : goals;
  return (
    <Card>
      <Partial shown={tasks.length} total={total} />
      <TaskMap layout={layoutMap(layoutGoals, tasks)} tasks={tasks} goals={layoutGoals} slug={slug} />
    </Card>
  );
}

/** Every task, as a board, a table, a calendar or a map, with the same filters across all four. */
export default async function TasksPage({ params, searchParams }: PageProps<"/w/[slug]/board">) {
  const { slug } = await params;
  const raw = await searchParams;
  const query: TaskQuery = {
    view: queryParam(raw.view),
    goal: queryParam(raw.goal),
    agent: queryParam(raw.agent),
    status: queryParam(raw.status),
    lane: queryParam(raw.lane),
    sort: queryParam(raw.sort),
    dir: queryParam(raw.dir),
    month: queryParam(raw.month),
    due: queryParam(raw.due),
    handoff: queryParam(raw.handoff),
  };
  const layout = parseTaskLayout(query.view);
  const { ctx } = await requireWorkspace(slug);
  const [goals, agents] = await Promise.all([listGoals(ctx, {}), query.agent ? listAgents(ctx, {}) : []]);
  const holder = query.agent ? agents.find((agent) => agent.id === query.agent) : undefined;
  const canWrite = can(ctx.actor, "task:write");
  const rows = parseBoardRows((await cookies()).get(BOARD_ROWS_COOKIE)?.value);

  return (
    <>
      <PageHeader
        title="Tasks"
        description={DESCRIPTIONS[layout](canWrite)}
        actions={<ManualEntry slug={slug} goals={goals} goalId={query.goal} canAddTask={canWrite} canAddGoal={can(ctx.actor, "goal:write")} />}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <TaskLayoutSwitcher slug={slug} layout={layout} query={query} />
        <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:w-full">
          <Suspense>
            <GoalFilter goals={goals} />
            {layout !== "board" && <StatusFilter />}
            <HandoffFilter />
          </Suspense>
          {layout === "board" && <BoardRowsToggle rows={rows} />}
          {/* The lanes are the workspace's stages, set in Settings; owners and admins reach them from the board too. */}
          {layout === "board" && can(ctx.actor, "workflow:manage") && (
            <ButtonLink href={routes.settings(slug)} variant="ghost" size="sm">
              <Columns3Cog aria-hidden />
              Edit lanes
            </ButtonLink>
          )}
        </div>
      </div>
      {layout === "table" && query.due === "none" && (
        <p className="-mt-2 mb-5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          Showing tasks with no due date.
          <Link href={routes.board(slug, { ...query, due: undefined })} className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink link">
            <X className="size-3.5" aria-hidden />
            Show every task
          </Link>
        </p>
      )}
      {query.agent && (
        <p className="-mt-2 mb-5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          Showing what {holder?.name ?? "this agent"} holds. Release a task from its ⋯ menu to hand it back.
          <Link href={routes.board(slug, { ...query, agent: undefined })} className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink link">
            <X className="size-3.5" aria-hidden />
            Show every task
          </Link>
        </p>
      )}
      <Layout layout={layout} ctx={ctx} slug={slug} query={query} goals={goals} canWrite={canWrite} rows={rows} />
    </>
  );
}

