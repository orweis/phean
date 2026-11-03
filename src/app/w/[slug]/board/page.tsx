import type { Metadata } from "next";
import { Suspense } from "react";

import { GoalFilter } from "@/components/goal-filter";
import { KanbanBoard } from "@/components/kanban-board";
import { ManualEntry } from "@/components/manual-entry";
import { PageHeader } from "@/components/page-header";
import { queryParam } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals } from "@/server/domain/goals";
import { getBoard } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { orNotFound } from "@/server/web";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({ params, searchParams }: PageProps<"/w/[slug]/board">) {
  const { slug } = await params;
  const goalId = queryParam((await searchParams).goal);
  const { ctx } = await requireWorkspace(slug);
  const [board, goals] = await Promise.all([orNotFound(getBoard(ctx, { goalId })), listGoals(ctx, {})]);
  const canWrite = can(ctx.actor, "task:write");

  return (
    <>
      <PageHeader
        title="Board"
        description="Every task by status. Done shows the 20 most recently completed."
        actions={
          <>
            <ManualEntry slug={slug} goals={goals} goalId={goalId} canAddTask={canWrite} canAddGoal={can(ctx.actor, "goal:write")} />
            <Suspense>
              <GoalFilter goals={goals} />
            </Suspense>
          </>
        }
      />
      <KanbanBoard board={board} slug={slug} canWrite={canWrite} />
    </>
  );
}
