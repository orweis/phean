import type { Board } from "@/server/domain/overview";
import type { TaskView } from "@/server/domain/tasks";

import { STATION_STYLE } from "./charts/stations";
import { TaskCard } from "./task-card";

/** Finished cards shown before the rest fold away, so Done does not outrun the open lanes. */
const DONE_SHOWN = 5;

function Cards({ tasks, slug, canWrite }: { tasks: readonly TaskView[]; slug: string; canWrite: boolean }) {
  return tasks.map((task) => <TaskCard key={task.id} task={task} slug={slug} canWrite={canWrite} />);
}

/** One lane per station, in the order work flows, each topped with its station colour. */
export function KanbanBoard({ board, slug, canWrite }: { board: Board; slug: string; canWrite: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {board.columns.map(({ status, tasks }) => {
        const shown = status === "done" ? tasks.slice(0, DONE_SHOWN) : tasks;
        const folded = tasks.slice(shown.length);
        return (
          <section key={status} aria-labelledby={`lane-${status}`} className="flex min-w-0 flex-col rounded-lg bg-sunken">
            <header className="px-3 pt-0 pb-2">
              <span aria-hidden className={`block h-1 rounded-b-xs ${STATION_STYLE[status].fill}`} />
              <div className="mt-2 flex items-baseline justify-between gap-2">
                <h2 id={`lane-${status}`} className="text-sm font-bold text-ink">
                  {STATION_STYLE[status].label}
                </h2>
                <span className="text-xs font-semibold text-muted">{tasks.length}</span>
              </div>
            </header>
            <div className="flex flex-col gap-2 px-2 pb-2">
              <Cards tasks={shown} slug={slug} canWrite={canWrite} />
              {folded.length > 0 && (
                <details className="group/more">
                  <summary className="cursor-pointer list-none rounded-md py-1.5 text-center text-xs font-semibold text-ink-2 link hover:text-ink [&::-webkit-details-marker]:hidden">
                    <span className="group-open/more:hidden">Show {folded.length} more</span>
                    <span className="hidden group-open/more:inline">Show fewer</span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <Cards tasks={folded} slug={slug} canWrite={canWrite} />
                  </div>
                </details>
              )}
              {tasks.length === 0 && <p className="px-1.5 py-6 text-center text-xs text-muted">Nothing here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
