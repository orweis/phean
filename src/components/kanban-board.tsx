import { Archive, EyeOff } from "lucide-react";
import Link from "next/link";

import { archiveDoneTasksAction } from "@/app/w/[slug]/actions";
import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";
import { SWIMLANE_META, SWIMLANES, swimlaneOf, type Swimlane } from "@/lib/swimlanes";
import type { Stage } from "@/lib/workflow";
import type { Board } from "@/server/domain/overview";
import type { TaskView } from "@/server/domain/tasks";

import { DraggableTask, DropLane } from "./board-dnd";
import { STATION_STYLE } from "./charts/stations";
import type { GoalOption } from "./goal-options";
import { TaskCard } from "./task-card";
import { ActionButton } from "./ui/action-button";
import { segment, SEGMENTED } from "./ui/segmented";

/** Finished cards shown before the rest fold away, so Done does not outrun the open lanes. */
const DONE_SHOWN = 5;

interface LaneProps {
  slug: string;
  canWrite: boolean;
  goals: readonly GoalOption[];
}

function Cards({ tasks, stage, slug, canWrite, goals }: LaneProps & { tasks: readonly TaskView[]; stage: Stage }) {
  return tasks.map((task) => {
    const card = <TaskCard key={task.id} task={task} slug={slug} canWrite={canWrite} goals={goals} />;
    return canWrite ? (
      <DraggableTask key={task.id} taskId={task.id} from={{ key: stage.key, label: stage.label }} title={task.title}>
        {card}
      </DraggableTask>
    ) : (
      card
    );
  });
}

/**
 * One stage's share of a swimlane: its cards, under a caption naming the lane and its count, so the
 * row reads across the board. Done folds all but its latest few, so it does not outrun the rest.
 */
function SwimlaneCell({ swimlane, tasks, fold, stage, ...props }: LaneProps & { swimlane: Swimlane; tasks: readonly TaskView[]; fold: boolean; stage: Stage }) {
  const shown = fold ? tasks.slice(0, DONE_SHOWN) : tasks;
  const folded = tasks.slice(shown.length);
  const { label, hint } = SWIMLANE_META[swimlane];
  return (
    <div
      role="group"
      aria-label={`${label}: ${stage.label}`}
      data-swimlane={swimlane}
      className={cx("flex min-h-16 min-w-0 flex-col gap-2 rounded-md p-1.5", swimlane === "people" ? "bg-wait-tint/40" : "bg-fill/50")}
    >
      <p className="flex items-center justify-between gap-2 px-1 text-xs font-semibold text-ink-2" title={hint}>
        {label}
        <span className="figure font-normal text-muted">{folded.length > 0 ? `${shown.length} of ${tasks.length}` : tasks.length}</span>
      </p>
      <Cards tasks={shown} stage={stage} {...props} />
      {folded.length > 0 && (
        <details className="group/more">
          <summary className="cursor-pointer list-none rounded-md py-1.5 text-center text-xs font-semibold text-ink-2 link hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">Show {folded.length} more</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <Cards tasks={folded} stage={stage} {...props} />
          </div>
        </details>
      )}
      {tasks.length === 0 && <p className="px-1 pb-1 text-xs text-muted">None</p>}
    </div>
  );
}

/** The lane a phone shows: the one asked for, else the first with cards, else the first lane. */
export function phoneLane(board: Board, asked: string | undefined): string {
  const named = board.columns.find((column) => column.stage.key === asked);
  return (named ?? board.columns.find((column) => column.tasks.length > 0) ?? board.columns[0])?.stage.key ?? "inbox";
}

/**
 * On phones the lanes would stack thousands of pixels deep, so a sticky picker shows one lane at
 * a time, held in the URL so a refresh keeps it. Each card's ⋯ menu moves it to any stage.
 */
function LanePicker({ board, slug, goalId, shown }: { board: Board; slug: string; goalId?: string; shown: string }) {
  return (
    <nav aria-label="Lane" className="sticky top-[6.75rem] z-20 -mx-1 mb-4 overflow-x-auto px-1 py-1 md:hidden">
      <div className={cx(SEGMENTED, "w-max min-w-full")}>
        {board.columns.map(({ stage, tasks }) => (
          <Link
            key={stage.key}
            href={routes.board(slug, { goal: goalId, lane: stage.key })}
            scroll={false}
            replace
            aria-current={stage.key === shown ? "page" : undefined}
            className={cx(segment(stage.key === shown), "flex-1 text-center whitespace-nowrap")}
          >
            {stage.label} <span className="figure font-normal">{tasks.length}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

interface KanbanBoardProps {
  board: Board;
  slug: string;
  canWrite: boolean;
  goals?: readonly GoalOption[];
  /** The goal filter, kept when the phone's lane picker switches lanes. */
  goalId?: string;
  /** The `?lane=` a phone asked for. */
  lane?: string;
}

/**
 * One lane per stage of the workspace, in the order work flows, each topped with its kind's
 * station colour. People who can write drag cards between lanes; each card's ⋯ menu does the
 * same from the keyboard or a phone. Each lane is a labelled region whose header offers a skip
 * link to the next, so keyboard users need not tab through every card. More than four lanes
 * scroll sideways on a wide screen rather than squeeze.
 */
export function KanbanBoard({ board, slug, canWrite, goals = [], goalId, lane }: KanbanBoardProps) {
  const shownOnPhone = phoneLane(board, lane);
  const many = board.columns.length > 4;
  return (
    <>
      <LanePicker board={board} slug={slug} goalId={goalId} shown={shownOnPhone} />
      <div
        data-lanes={board.columns.length}
        className={cx(
          "grid gap-4 md:grid-cols-2",
          many ? "xl:grid-flow-col xl:auto-cols-[minmax(14rem,1fr)] xl:grid-cols-none xl:overflow-x-auto xl:pb-2" : "xl:grid-cols-4",
        )}
      >
        {board.columns.map(({ stage, tasks }, index) => {
          const next = board.columns[index + 1]?.stage;
          // The first Done lane clears every done task at once; the rare, sweeping move asks first.
          const clears = canWrite && tasks.length > 0 && stage.kind === "done" && board.columns.findIndex((column) => column.stage.kind === "done") === index;
          const props = { slug, canWrite, goals, stage };
          // The two horizontal lanes: on a wide screen each stage's rows line up across the board.
          const body = (
            <div className="flex min-w-0 flex-col gap-3 xl:row-span-2 xl:grid xl:grid-rows-subgrid xl:gap-y-3">
              {SWIMLANES.map((swimlane) => (
                <SwimlaneCell
                  key={swimlane}
                  swimlane={swimlane}
                  tasks={tasks.filter((task) => swimlaneOf(task) === swimlane)}
                  fold={stage.kind === "done"}
                  {...props}
                />
              ))}
            </div>
          );
          return (
            <section
              key={stage.key}
              aria-labelledby={`lane-${stage.key}`}
              data-station={stage.kind}
              data-stage={stage.key}
              className={cx("flex min-w-0 flex-col xl:row-span-3 xl:grid xl:grid-rows-subgrid xl:gap-y-0", stage.key !== shownOnPhone && "max-md:hidden")}
            >
              <header className="pb-2.5">
                <span aria-hidden className={`block h-1 rounded-full ${STATION_STYLE[stage.kind].fill}`} />
                <div className="mt-2.5 flex h-8 items-center gap-2 px-1">
                  <h2 id={`lane-${stage.key}`} tabIndex={-1} className="min-w-0 scroll-mt-32 truncate text-sm font-bold text-ink outline-none" title={stage.label}>
                    {stage.label}
                  </h2>
                  <span data-count className="figure inline-flex h-5 shrink-0 items-center rounded-full bg-fill px-2 text-xs font-semibold text-ink-2">
                    {tasks.length}
                  </span>
                  {stage.hidden && (
                    // A hidden stage stays on the board only while tasks are still in it.
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted" title="Hidden in settings; shown while tasks are in it">
                      <EyeOff className="size-3" aria-hidden />
                      Hidden
                    </span>
                  )}
                  {clears && (
                    <ActionButton
                      action={archiveDoneTasksAction}
                      fields={{}}
                      workspace={slug}
                      confirm="Archive every done task? They leave the board but keep their history, and each can be brought back from its page."
                      closeOnSuccess
                      size="sm"
                      variant="ghost"
                      className="ml-auto px-2"
                      aria-label="Archive all done tasks"
                      title="Archive all done tasks"
                    >
                      <Archive aria-hidden />
                    </ActionButton>
                  )}
                  {next && tasks.length > 0 && (
                    <a
                      href={`#lane-${next.key}`}
                      className="sr-only ml-auto rounded-full text-xs font-semibold text-accent-ink focus-visible:not-sr-only max-md:hidden"
                    >
                      Skip to {next.label}
                    </a>
                  )}
                </div>
              </header>
              {canWrite ? (
                <DropLane stage={stage} slug={slug} className="min-h-24 min-w-0 flex-1 xl:row-span-2 xl:grid xl:grid-rows-subgrid xl:gap-y-3">
                  {body}
                </DropLane>
              ) : (
                body
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
