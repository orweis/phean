import type { Board } from "@/server/domain/overview";

import { STATION_STYLE } from "./charts/stations";
import { TaskCard } from "./task-card";

/** One lane per station, in the order work flows, each topped with its station colour. */
export function KanbanBoard({ board, slug, canWrite }: { board: Board; slug: string; canWrite: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {board.columns.map(({ status, tasks }) => (
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
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} slug={slug} canWrite={canWrite} />
            ))}
            {tasks.length === 0 && <p className="px-1.5 py-6 text-center text-xs text-muted">Nothing here</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
