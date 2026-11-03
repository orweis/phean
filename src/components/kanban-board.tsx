import type { Board } from "@/server/domain/overview";
import type { TaskView } from "@/server/domain/tasks";

import { DraggableTask, DropLane } from "./board-dnd";
import { STATION_STYLE } from "./charts/stations";
import type { GoalOption } from "./goal-options";
import { TaskCard } from "./task-card";

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

/**
 * One lane per station, in the order work flows, each topped with its station colour. People who
 * can write drag cards between lanes; the buttons on each card do the same from the keyboard.
 */
export function KanbanBoard({ board, slug, canWrite, goals = [] }: { board: Board; slug: string; canWrite: boolean; goals?: readonly GoalOption[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {board.columns.map(({ status, tasks }) => {
        const shown = status === "done" ? tasks.slice(0, DONE_SHOWN) : tasks;
        const folded = tasks.slice(shown.length);
        const lane = { slug, canWrite, goals };
        const body = (
          <div className="flex flex-col gap-2">
            <Cards tasks={shown} {...lane} />
            {folded.length > 0 && (
              <details className="group/more">
                <summary className="cursor-pointer list-none rounded-md py-1.5 text-center text-xs font-semibold text-ink-2 link hover:text-ink [&::-webkit-details-marker]:hidden">
                  <span className="group-open/more:hidden">Show {folded.length} more</span>
                  <span className="hidden group-open/more:inline">Show fewer</span>
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                  <Cards tasks={folded} {...lane} />
                </div>
              </details>
            )}
            {tasks.length === 0 && (
              <p className="rounded-md border border-dashed border-rule px-1.5 py-6 text-center text-xs text-muted">
                {canWrite ? "Drop a task here" : "Nothing here"}
              </p>
            )}
          </div>
        );
        return (
          <section key={status} aria-labelledby={`lane-${status}`} className="flex min-w-0 flex-col">
            <header className="pb-2.5">
              <span aria-hidden className={`block h-1 rounded-full ${STATION_STYLE[status].fill}`} />
              <div className="mt-2.5 flex items-baseline justify-between gap-2 px-1">
                <h2 id={`lane-${status}`} className="text-sm font-bold text-ink">
                  {STATION_STYLE[status].label}
                </h2>
                <span className="text-xs font-semibold text-muted">{tasks.length}</span>
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
  );
}
