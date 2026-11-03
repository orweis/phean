import { and, desc, eq } from "drizzle-orm";

import { MEMORY_KIND_META } from "@/lib/domain";
import { truncate } from "@/lib/format";

import { publicColumns } from "../db/columns";
import { matchesTsQuery, prefixTsQuery, tsRank } from "../db/fts";
import { newId } from "../db/ids";
import { memories, type MemoryRow } from "../db/schema";
import { createdByFields, inTenant, inTransaction, tenantRow } from "./context";
import { forbidden, notFound } from "./errors";
import { recordEvent } from "./events";
import { assertGoalsExist } from "./goals";
import { assertCan } from "./policy";
import { MemoryRefInput, RecallInput, RememberInput } from "./schemas";
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
