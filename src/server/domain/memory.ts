import { and, count, desc, eq } from "drizzle-orm";

import { MEMORY_KIND_META, MEMORY_KINDS, zeroCounts, type MemoryKind } from "@/lib/domain";
import { truncate } from "@/lib/format";

import { patchOf, publicColumns } from "../db/columns";
import { matchesTsQuery, prefixTsQuery, tsRank } from "../db/fts";
import { newId } from "../db/ids";
import { memories, type MemoryRow } from "../db/schema";
import { createdByFields, inTenant, inTransaction, tenantRow } from "./context";
import { forbidden, invalid, notFound } from "./errors";
import { recordEvent } from "./events";
import { assertGoalsExist } from "./goals";
import { assertCan } from "./policy";
import { MemoryCountsInput, MemoryRefInput, RecallInput, RememberInput, UpdateMemoryInput } from "./schemas";
import { service } from "./service";
import { findTask } from "./tasks";

export type Memory = Omit<MemoryRow, "tenantId" | "search">;

const memoryColumns = publicColumns(memories, ["tenantId", "search"]);

export const remember = service(RememberInput, async (ctx, input): Promise<Memory> => {
  assertCan(ctx, "memory:write");
  if (input.goalId) await assertGoalsExist(ctx, [input.goalId]);
  if (input.taskId) await findTask(ctx, input.taskId);

  return inTransaction(ctx, async (tx) => {
    const [memory] = await tx.db
      .insert(memories)
      .values({
        id: newId("m"),
        tenantId: tx.tenant.id,
        kind: input.kind,
        content: input.content,
        tags: input.tags,
        goalId: input.goalId ?? null,
        taskId: input.taskId ?? null,
        ...createdByFields(tx.actor),
      })
      .returning(memoryColumns);
    await recordEvent(tx, {
      action: "memory.saved",
      entityType: "memory",
      entityId: memory!.id,
      summary: `remembered a ${MEMORY_KIND_META[input.kind].label.toLowerCase()}: "${truncate(input.content, 80)}"`,
      data: { goalId: memory!.goalId, taskId: memory!.taskId },
    });
    return memory!;
  });
});

export const recall = service(RecallInput, async (ctx, { query, kind, goalId, limit }): Promise<Memory[]> => {
  assertCan(ctx, "workspace:read");
  const tsQuery = query ? prefixTsQuery(query) : null;
  return ctx.db
    .select(memoryColumns)
    .from(memories)
    .where(
      and(
        inTenant(ctx, memories),
        kind ? eq(memories.kind, kind) : undefined,
        goalId ? eq(memories.goalId, goalId) : undefined,
        tsQuery ? matchesTsQuery(memories.search, tsQuery) : undefined,
      ),
    )
    .orderBy(...(tsQuery ? [desc(tsRank(memories.search, tsQuery))] : []), desc(memories.updatedAt))
    .limit(limit);
});

/** How many memories of each kind there are, or match `query`: the counts on the Memory page's filters. */
export const countMemoryKinds = service(MemoryCountsInput, async (ctx, { query }): Promise<Record<MemoryKind, number>> => {
  assertCan(ctx, "workspace:read");
  const tsQuery = query ? prefixTsQuery(query) : null;
  const rows = await ctx.db
    .select({ kind: memories.kind, count: count() })
    .from(memories)
    .where(and(inTenant(ctx, memories), tsQuery ? matchesTsQuery(memories.search, tsQuery) : undefined))
    .groupBy(memories.kind);
  const counts = zeroCounts(MEMORY_KINDS);
  for (const row of rows) counts[row.kind] = Number(row.count);
  return counts;
});

/** Fixes a memory that is wrong or out of date. Agents edit only what they saved; people any memory. */
export const updateMemory = service(UpdateMemoryInput, async (ctx, { memoryId, ...fields }): Promise<Memory> => {
  assertCan(ctx, "memory:write");
  const [current] = await ctx.db.select(memoryColumns).from(memories).where(tenantRow(ctx, memories, memoryId));
  if (!current) throw notFound("memory", memoryId);
  if (ctx.actor.type === "agent" && current.createdById !== ctx.actor.id) {
    throw forbidden("Agents can only edit memories they saved themselves. Save a correction with remember, or ask a human.");
  }
  if (fields.goalId) await assertGoalsExist(ctx, [fields.goalId]);
  const patch = patchOf({
    content: fields.content !== current.content ? fields.content : undefined,
    kind: fields.kind !== current.kind ? fields.kind : undefined,
    tags: fields.tags && fields.tags.join("\u0000") !== current.tags.join("\u0000") ? fields.tags : undefined,
    goalId: fields.goalId !== undefined && fields.goalId !== current.goalId ? fields.goalId : undefined,
  });
  const changed = Object.keys(patch);
  if (changed.length === 0) throw invalid("Nothing to update: the memory already says that.");

  return inTransaction(ctx, async (tx) => {
    const [memory] = await tx.db.update(memories).set(patch).where(tenantRow(tx, memories, memoryId)).returning(memoryColumns);
    await recordEvent(tx, {
      action: "memory.updated",
      entityType: "memory",
      entityId: memoryId,
      summary: `updated a ${MEMORY_KIND_META[memory!.kind].label.toLowerCase()}: "${truncate(memory!.content, 80)}"`,
      data: { goalId: memory!.goalId, taskId: memory!.taskId, changed },
    });
    return memory!;
  });
});

export const forget = service(MemoryRefInput, async (ctx, { memoryId }): Promise<{ forgotten: string }> => {
  assertCan(ctx, "memory:write");
  const [memory] = await ctx.db
    .select(memoryColumns)
    .from(memories)
    .where(tenantRow(ctx, memories, memoryId));
  if (!memory) throw notFound("memory", memoryId);
  if (ctx.actor.type === "agent" && memory.createdById !== ctx.actor.id) {
    throw forbidden("Agents can only forget memories they saved themselves. Ask a human to remove this one.");
  }

  await inTransaction(ctx, async (tx) => {
    await tx.db.delete(memories).where(tenantRow(tx, memories, memoryId));
    await recordEvent(tx, {
      action: "memory.forgotten",
      entityType: "memory",
      entityId: memoryId,
      summary: `forgot "${truncate(memory.content, 80)}"`,
    });
  });
  return { forgotten: memoryId };
});
