import { TASK_STATUS_META } from "@/lib/domain";
import type { Board } from "@/server/domain/overview";

import { TaskCard } from "./task-card";

export function KanbanBoard({ board, slug, canWrite }: { board: Board; slug: string; canWrite: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {board.columns.map(({ status, tasks }) => (
        <section key={status} className="flex min-w-0 flex-col rounded-xl bg-zinc-100/70 p-2">
          <header className="flex items-center justify-between px-1.5 pt-1 pb-2">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-600 uppercase">{TASK_STATUS_META[status].label}</h2>
            <span className="rounded-full bg-white px-2 text-xs font-medium text-zinc-500 tabular-nums">{tasks.length}</span>
          </header>
          <div className="flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} slug={slug} canWrite={canWrite} />
            ))}
            {tasks.length === 0 && <p className="px-1.5 py-6 text-center text-xs text-zinc-400">Nothing here</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
