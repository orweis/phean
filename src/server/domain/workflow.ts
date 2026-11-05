import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";

import { isBuiltIn, normalizeWorkflow, stageKeyFor, workflowProblem, type Stage } from "@/lib/workflow";

import { tasks, workspaceSettings } from "../db/schema";
import { inTenant, inTransaction, type Ctx } from "./context";
import { invalid } from "./errors";
import { recordEvent } from "./events";
import { assertCan } from "./policy";
import { Empty, SaveWorkflowInput } from "./schemas";
import { service } from "./service";

/** The workspace's stages, made whole and in flow order; the defaults until someone saves their own. */
export async function loadWorkflow(ctx: Ctx): Promise<Stage[]> {
  const [row] = await ctx.db.select({ workflow: workspaceSettings.workflow }).from(workspaceSettings).where(eq(workspaceSettings.tenantId, ctx.tenant.id));
  return normalizeWorkflow(row?.workflow);
}

export const getWorkflow = service(Empty, async (ctx): Promise<Stage[]> => {
  assertCan(ctx, "workspace:read");
  return loadWorkflow(ctx);
});

/**
 * Saves the board's stages: renamed, hidden, reordered within their kind, added or removed. A new
 * stage gets its key from its name. An existing stage keeps its kind (remove it and add another to
 * change that). Tasks in a removed stage fall back to their kind's built-in stage.
 */
export const saveWorkflow = service(SaveWorkflowInput, async (ctx, { stages }): Promise<Stage[]> => {
  assertCan(ctx, "workflow:manage");
  const current = await loadWorkflow(ctx);
  const next: Stage[] = [];
  for (const draft of stages) {
    const existing = draft.key ? current.find((stage) => stage.key === draft.key) : undefined;
    if (draft.key && !existing) throw invalid(`There is no stage "${draft.key}" to change. Leave the key out to add a stage.`);
    if (existing && existing.kind !== draft.kind) throw invalid(`"${existing.label}" stays a ${existing.kind} stage; remove it and add a new one to change that.`);
    const key = existing?.key ?? stageKeyFor([...current, ...next], draft.label);
    next.push({ key, label: draft.label.trim(), kind: draft.kind, hidden: draft.hidden });
  }
  const problem = workflowProblem(next);
  if (problem) throw invalid(problem);
  const saved = normalizeWorkflow(next);

  return inTransaction(ctx, async (tx) => {
    await tx.db
      .insert(workspaceSettings)
      .values({ tenantId: tx.tenant.id, workflow: saved })
      .onConflictDoUpdate({ target: workspaceSettings.tenantId, set: { workflow: saved, updatedAt: new Date() } });
    // Tasks in a removed stage fall back to their kind's built-in stage.
    const kept = saved.filter((stage) => !isBuiltIn(stage)).map((stage) => stage.key);
    await tx.db
      .update(tasks)
      .set({ stage: null })
      .where(and(inTenant(tx, tasks), isNotNull(tasks.stage), kept.length ? notInArray(tasks.stage, kept) : sql`true`));
    const removed = current.filter((stage) => !saved.some((kept) => kept.key === stage.key)).map((stage) => stage.label);
    await recordEvent(tx, {
      action: "workspace.workflow_updated",
      entityType: "workspace",
      entityId: tx.tenant.id,
      summary: removed.length ? `updated the board's stages and removed ${removed.join(", ")}` : "updated the board's stages",
      data: { stages: saved.map((stage) => stage.key) },
    });
    return saved;
  });
});
