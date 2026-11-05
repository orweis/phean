import type { Metadata } from "next";
import { Columns3Cog, X } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { GoalFilter } from "@/components/goal-filter";
import { KanbanBoard } from "@/components/kanban-board";
import { ManualEntry } from "@/components/manual-entry";
import { PageHeader } from "@/components/page-header";
import { ButtonLink } from "@/components/ui/button";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listAgents } from "@/server/domain/agents";
import { listGoals } from "@/server/domain/goals";
import { getBoard } from "@/server/domain/overview";
import { can } from "@/server/domain/policy";
import { orNotFound } from "@/server/web";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({ params, searchParams }: PageProps<"/w/[slug]/board">) {
  const { slug } = await params;
  const query = await searchParams;
  const goalId = queryParam(query.goal);
  const heldBy = queryParam(query.agent);
  const { ctx } = await requireWorkspace(slug);
  const [board, goals, agents] = await Promise.all([orNotFound(getBoard(ctx, { goalId, heldBy })), listGoals(ctx, {}), heldBy ? listAgents(ctx, {}) : []]);
  const holder = heldBy ? agents.find((agent) => agent.id === heldBy) : undefined;
  const canWrite = can(ctx.actor, "task:write");

  return (
    <>
      <PageHeader
        title="Board"
        description={
          canWrite ? (
            <>
              Every task by status. <span className="pointer-coarse:hidden">Drag a card to another lane to move it, or use its buttons.</span>
              <span className="hidden pointer-coarse:inline">Move a card with its buttons.</span> Edit changes its details. Done shows the 20 most
              recently completed.
            </>
          ) : (
            "Every task by status. Done shows the 20 most recently completed."
          )
        }
        actions={
          <>
            <ManualEntry slug={slug} goals={goals} goalId={goalId} canAddTask={canWrite} canAddGoal={can(ctx.actor, "goal:write")} />
            <Suspense>
              <GoalFilter goals={goals} />
            </Suspense>
            {/* The lanes are the workspace's stages, set in Settings; owners and admins reach them from here too. */}
            {can(ctx.actor, "workflow:manage") && (
              <ButtonLink href={routes.settings(slug)} variant="ghost" size="sm">
                <Columns3Cog aria-hidden />
                Edit lanes
              </ButtonLink>
            )}
          </>
        }
      />
      {heldBy && (
        <p className="-mt-3 mb-5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
          Showing what {holder?.name ?? "this agent"} holds. Release a task from its ⋯ menu to hand it back.
          <Link href={routes.board(slug, { goal: goalId })} className="inline-flex items-center gap-1 text-xs font-semibold text-accent-ink link">
            <X className="size-3.5" aria-hidden />
            Show every task
          </Link>
        </p>
      )}
      <KanbanBoard board={board} slug={slug} canWrite={canWrite} goals={goals} goalId={goalId} lane={queryParam(query.lane)} />
    </>
  );
}
