import { Archive, Bot, EyeOff, User } from "lucide-react";
import Link from "next/link";

import { archiveDoneTasksAction } from "@/app/w/[slug]/actions";
import { cx } from "@/lib/cx";
import { routes } from "@/lib/routes";
import { SWIMLANE_META, SWIMLANES, swimlaneOf, type BoardRows, type Swimlane } from "@/lib/swimlanes";
import type { Stage } from "@/lib/workflow";
import type { Board } from "@/server/domain/overview";
import type { TaskView } from "@/server/domain/tasks";

import { DraggableTask, DropLane } from "./board-dnd";
import { STATION_STYLE } from "./charts/stations";
import type { GoalOption } from "./goal-options";
import { TaskCard } from "./task-card";
import { ActionButton } from "./ui/action-button";
import { ChipRail } from "./ui/chip-rail";
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

const ROW_ICON: Record<Swimlane, typeof User> = { people: User, agents: Bot };

/**
 * One stage's share of a row: its cards under a caption naming the row and its count, so the row
 * reads across the board; the Agents row is ruled off from People by a hairline, which lines up
 * across the lanes on a wide screen. With the split off (`swimlane` null) it is the lane's one list.
 * Done folds all but its latest few, so it does not outrun the rest.
 */
function LaneCell({ swimlane, tasks, fold, stage, ...props }: LaneProps & { swimlane: Swimlane | null; tasks: readonly TaskView[]; fold: boolean; stage: Stage }) {
  const shown = fold ? tasks.slice(0, DONE_SHOWN) : tasks;
  const folded = tasks.slice(shown.length);
  const meta = swimlane && SWIMLANE_META[swimlane];
  const Icon = swimlane && ROW_ICON[swimlane];
  return (
    <div
      role={meta ? "group" : undefined}
      aria-label={meta ? `${meta.label}: ${stage.label}` : undefined}
      data-swimlane={swimlane ?? undefined}
      className={cx("flex min-w-0 flex-col gap-2", swimlane === "agents" && "border-t border-rule pt-3")}
    >
      {meta && Icon && (
        <p className="flex h-5 items-center gap-1.5 px-1 text-xs font-semibold text-ink-2" title={meta.hint}>
          <Icon className="size-3.5 text-muted" aria-hidden />
          {meta.label}
          <span className="figure ml-auto font-normal text-muted">{folded.length > 0 ? `${shown.length} of ${tasks.length}` : tasks.length}</span>
        </p>
      )}
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
      {tasks.length === 0 && (
        <p className={cx("rounded-md border border-dashed border-rule px-2 text-center text-xs text-muted", meta ? "py-3" : "py-6")}>
          {props.canWrite ? (
            <>
              <span className="pointer-coarse:hidden">{meta ? "None. Drop a task here" : "Drop a task here"}</span>
              <span className="hidden pointer-coarse:inline">Nothing here yet</span>
            </>
          ) : (
            "Nothing here"
          )}
        </p>
      )}
    </div>
  );
}

/** A lane header's height (rail, title row, padding): the spacer that keeps the split rows below it. */
const LANE_HEADER_HEIGHT = "h-14";

/** The lane a phone shows: the one asked for, else the first with cards, else the first lane. */
export function phoneLane(board: Board, asked: string | undefined): string {
  const named = board.columns.find((column) => column.stage.key === asked);
  return (named ?? board.columns.find((column) => column.tasks.length > 0) ?? board.columns[0])?.stage.key ?? "inbox";
}

/**
 * On phones the lanes would stack thousands of pixels deep, so a sticky picker shows one lane at
 * a time, held in the URL so a refresh keeps it, with the chosen lane's chip scrolled to the middle
 * of the picker. Each card's ⋯ menu moves it to any stage.
 */
function LanePicker({ board, slug, goalId, shown }: { board: Board; slug: string; goalId?: string; shown: string }) {
  return (
    <ChipRail label="Lane" selected={shown} className="sticky top-[6.75rem] z-20 -mx-1 mb-4 px-1 py-1 md:hidden">
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
    </ChipRail>
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
  /** Split each lane into the People and Agents rows (the default), or show it as one list. */
  rows?: BoardRows;
}

/**
 * One lane per stage of the workspace, in the order work flows, each topped with its kind's
 * station colour. People who can write drag cards between lanes; each card's ⋯ menu does the
 * same from the keyboard or a phone. Each lane is a labelled region whose header offers a skip
 * link to the next, so keyboard users need not tab through every card. More than four lanes
 * scroll sideways on a wide screen rather than squeeze.
 */
export function KanbanBoard({ board, slug, canWrite, goals = [], goalId, lane, rows = "split" }: KanbanBoardProps) {
  const split = rows === "split";
  const shownOnPhone = phoneLane(board, lane);
  const many = board.columns.length > 4;
  return (
    <>
      <LanePicker board={board} slug={slug} goalId={goalId} shown={shownOnPhone} />
      <div
        data-lanes={board.columns.length}
        className={cx(
          "grid gap-4 md:grid-cols-2",
          // Past four lanes the board scrolls sideways. A scroller would pin the lane headers to itself
          // rather than the page, so it takes the screen's height and scrolls both ways, headers on top.
          many
            ? "xl:max-h-[calc(100dvh-7.5rem)] xl:grid-flow-col xl:auto-cols-[minmax(14rem,1fr)] xl:grid-cols-none xl:overflow-auto xl:overscroll-contain xl:pb-2"
            : "xl:grid-cols-4",
        )}
      >
        {board.columns.map(({ stage, tasks }, index) => {
          const next = board.columns[index + 1]?.stage;
          // The first Done lane clears every done task at once; the rare, sweeping move asks first.
          const clears = canWrite && tasks.length > 0 && stage.kind === "done" && board.columns.findIndex((column) => column.stage.kind === "done") === index;
          const props = { slug, canWrite, goals, stage };
          // The two horizontal rows: on a wide screen each stage's rows line up across the board.
          const body = split ? (
            // Inside a drop lane the rows are the drop lane's own; read-only, they are the section's, below its header.
            <div className={cx("flex min-w-0 flex-col gap-3 xl:row-span-2 xl:grid xl:grid-rows-subgrid xl:gap-y-3", !canWrite && "xl:col-start-1 xl:row-start-2")}>
              {SWIMLANES.map((swimlane) => (
                <LaneCell key={swimlane} swimlane={swimlane} tasks={tasks.filter((task) => swimlaneOf(task) === swimlane)} fold={stage.kind === "done"} {...props} />
              ))}
            </div>
          ) : (
            <LaneCell swimlane={null} tasks={tasks} fold={stage.kind === "done"} {...props} />
          );
          return (
            <section
              key={stage.key}
              aria-labelledby={`lane-${stage.key}`}
              data-station={stage.kind}
              data-stage={stage.key}
              className={cx("flex min-w-0 flex-col", split && "xl:row-span-3 xl:grid xl:grid-rows-subgrid xl:gap-y-0", stage.key !== shownOnPhone && "max-md:hidden")}
            >
              {/*
                The lane's name stays in view while a long People row scrolls past, so the Agents row
                below still says whose lane it is. A sticky grid item moves only within its own cell, so
                with the rows split the header spans all three of the lane's rows, pinned to the top,
                and a spacer holds the first row open at the header's height.
              */}
              <header
                className={cx(
                  "z-10 bg-paper pb-2.5 md:sticky md:top-[6.75rem]",
                  many && "xl:top-0",
                  split && "xl:col-start-1 xl:row-span-3 xl:row-start-1 xl:self-start",
                )}
              >
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
              {split && <div aria-hidden className={cx("hidden xl:col-start-1 xl:row-start-1 xl:block", LANE_HEADER_HEIGHT)} />}
              {canWrite ? (
                <DropLane stage={stage} slug={slug} className={cx("min-h-24 min-w-0 flex-1", split && "xl:col-start-1 xl:row-span-2 xl:row-start-2 xl:grid xl:grid-rows-subgrid xl:gap-y-3")}>
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
