import type { Metadata } from "next";
import { Suspense } from "react";

import { AddTaskForm } from "@/components/add-task-form";
import { GoalFilter } from "@/components/goal-filter";
import { KanbanBoard } from "@/components/kanban-board";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
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
  const openGoals = goals.filter((candidate) => candidate.status === "active" || candidate.status === "proposed");

  return (
    <>
      <PageHeader
        title="Board"
        description="Every task by status. Done shows the 20 most recently completed."
        actions={
          <Suspense>
            <GoalFilter goals={goals} />
          </Suspense>
        }
      />
      {canWrite && (
        <Card className="mb-6">
          <CardBody className="py-3">
            <AddTaskForm slug={slug} goals={openGoals} goalId={goalId} />
          </CardBody>
        </Card>
      )}
      <KanbanBoard board={board} slug={slug} canWrite={canWrite} />
    </>
  );
}
