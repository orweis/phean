import Link from "next/link";

import { cx } from "@/lib/cx";
import { STATIONS, type Station } from "@/lib/domain";
import { routes } from "@/lib/routes";
import type { Board } from "@/server/domain/overview";
import type { TaskView } from "@/server/domain/tasks";

import { DraggableTask, DropLane } from "./board-dnd";
import { STATION_STYLE } from "./charts/stations";
import type { GoalOption } from "./goal-options";
import { TaskCard } from "./task-card";
import { segment, SEGMENTED } from "./ui/segmented";

/** Finished cards shown before the rest fold away, so Done does not outrun the open lanes. */
const DONE_SHOWN = 5;

interface LaneProps {
  slug: string;
  canWrite: boolean;
  goals: readonly GoalOption[];
}

function Cards({ tasks, slug, canWrite, goals }: LaneProps & { tasks: readonly TaskView[] }) {
  return tasks.map((task) => {
    const card = <TaskCard key={task.id} task={task} slug={slug} canWrite={canWrite} goals={goals} />;
    return canWrite ? (
      <DraggableTask key={task.id} taskId={task.id} status={task.status} title={task.title}>
        {card}
      </DraggableTask>
    ) : (
      card
    );
  });
}

/** The lane a phone shows: the one asked for, else the first with cards, else the inbox. */
export function phoneLane(board: Board, asked: string | undefined): Station {
  const named = STATIONS.find((station) => station === asked);
  return named ?? board.columns.find((column) => column.tasks.length > 0)?.status ?? "inbox";
}

/**
 * On phones the lanes would stack thousands of pixels deep, so a sticky picker shows one lane at
 * a time, held in the URL so a refresh keeps it. Each card's buttons do every move a drag would.
 */
function LanePicker({ board, slug, goalId, shown }: { board: Board; slug: string; goalId?: string; shown: Station }) {
  return (
    <nav aria-label="Lane" className="sticky top-[6.75rem] z-20 -mx-1 mb-4 overflow-x-auto px-1 py-1 md:hidden">
      <div className={cx(SEGMENTED, "w-max min-w-full")}>
        {board.columns.map(({ status, tasks }) => (
          <Link
            key={status}
            href={routes.board(slug, { goal: goalId, lane: status })}
            scroll={false}
            replace
            aria-current={status === shown ? "page" : undefined}
            className={cx(segment(status === shown), "flex-1 text-center whitespace-nowrap")}
          >
            {STATION_STYLE[status].label} <span className="figure font-normal">{tasks.length}</span>
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
 * One lane per station, in the order work flows, each topped with its station colour. People who
 * can write drag cards between lanes; the buttons on each card do the same from the keyboard.
 * Each lane is a labelled region whose header offers a skip link to the next, so keyboard users
 * need not tab through every card.
 */
export function KanbanBoard({ board, slug, canWrite, goals = [], goalId, lane }: KanbanBoardProps) {
  const shownOnPhone = phoneLane(board, lane);
  return (
    <>
      <LanePicker board={board} slug={slug} goalId={goalId} shown={shownOnPhone} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {board.columns.map(({ status, tasks }, index) => {
          const shown = status === "done" ? tasks.slice(0, DONE_SHOWN) : tasks;
          const folded = tasks.slice(shown.length);
          const next = board.columns[index + 1]?.status;
          const props = { slug, canWrite, goals };
          const body = (
            <div className="flex flex-col gap-2">
              <Cards tasks={shown} {...props} />
              {folded.length > 0 && (
                <details className="group/more">
                  <summary className="cursor-pointer list-none rounded-md py-1.5 text-center text-xs font-semibold text-ink-2 link hover:text-ink [&::-webkit-details-marker]:hidden">
                    <span className="group-open/more:hidden">Show {folded.length} more</span>
                    <span className="hidden group-open/more:inline">Show fewer</span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <Cards tasks={folded} {...props} />
                  </div>
                </details>
              )}
              {tasks.length === 0 && (
                <p className="rounded-md border border-dashed border-rule px-1.5 py-6 text-center text-xs text-muted">
                  {canWrite ? (
                    <>
                      <span className="pointer-coarse:hidden">Drop a task here</span>
                      <span className="hidden pointer-coarse:inline">Nothing here yet</span>
                    </>
                  ) : (
                    "Nothing here"
                  )}
                </p>
              )}
            </div>
          );
          return (
            <section
              key={status}
              aria-labelledby={`lane-${status}`}
              data-station={status}
              className={cx("flex min-w-0 flex-col", status !== shownOnPhone && "max-md:hidden")}
            >
              <header className="pb-2.5">
                <span aria-hidden className={`block h-1 rounded-full ${STATION_STYLE[status].fill}`} />
                <div className="mt-2.5 flex items-center gap-2 px-1">
                  <h2 id={`lane-${status}`} tabIndex={-1} className="scroll-mt-32 text-sm font-bold text-ink outline-none">
                    {STATION_STYLE[status].label}
                  </h2>
                  <span data-count className="figure inline-flex h-5 items-center rounded-full bg-fill px-2 text-xs font-semibold text-ink-2">
                    {folded.length > 0 ? `${shown.length} of ${tasks.length}` : tasks.length}
                  </span>
                  {next && tasks.length > 0 && (
                    <a
                      href={`#lane-${next}`}
                      className="sr-only ml-auto rounded-full text-xs font-semibold text-accent-ink focus-visible:not-sr-only max-md:hidden"
                    >
                      Skip to {STATION_STYLE[next].label}
                    </a>
                  )}
                </div>
              </header>
              {canWrite ? (
                <DropLane status={status} slug={slug} className="min-h-24 flex-1">
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
