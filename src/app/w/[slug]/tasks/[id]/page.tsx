import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { TaskDetail } from "@/components/task-detail";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { getTask } from "@/server/domain/tasks";
import { orNotFound } from "@/server/web";

const loadTask = cache(async (slug: string, id: string) => {
  const { ctx } = await requireWorkspace(slug);
  return orNotFound(getTask(ctx, { taskId: id }));
});

export async function generateMetadata({ params }: PageProps<"/w/[slug]/tasks/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  return { title: (await loadTask(slug, id)).task.title };
}

/** A task as its own page: what a shared link or a refresh opens, and the peek's "Open as page". */
export default async function TaskPage({ params }: PageProps<"/w/[slug]/tasks/[id]">) {
  const { slug, id } = await params;
  await loadTask(slug, id);
  return (
    <div className="max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-3 text-xs text-muted">
        <Link href={routes.board(slug)} className="hover:text-ink link">
          Board
        </Link>
      </nav>
      <TaskDetail slug={slug} taskId={id} />
    </div>
  );
}
