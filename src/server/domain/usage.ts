import { waitUntil } from "@vercel/functions";
import { sql } from "drizzle-orm";

import { todayIso } from "@/lib/dates";

import { toolCallsDaily } from "../db/schema";
import type { Ctx } from "./context";

/**
 * Counts one MCP tool call for the backoffice: a per-day aggregate (`tool_calls_daily`), never a raw
 * log, and never the call's input or result. The tenant and agent come from the caller's `Ctx`.
 */
export async function countToolCall(ctx: Ctx, tool: string, failed: boolean, now = new Date()): Promise<void> {
  if (ctx.actor.type !== "agent") return;
  const errors = failed ? 1 : 0;
  await ctx.db
    .insert(toolCallsDaily)
    .values({ day: todayIso(now), tenantId: ctx.tenant.id, agentId: ctx.actor.id, tool, calls: 1, errors })
    .onConflictDoUpdate({
      target: [toolCallsDaily.day, toolCallsDaily.tenantId, toolCallsDaily.agentId, toolCallsDaily.tool],
      set: { calls: sql`${toolCallsDaily.calls} + 1`, errors: sql`${toolCallsDaily.errors} + ${errors}` },
    });
}

type CountScheduler = (run: () => Promise<void>) => void;

/** Off the request path: the count finishes after the response (waitUntil keeps a Vercel function alive for it). */
const defaultScheduler: CountScheduler = (run) => waitUntil(run());
let scheduler: CountScheduler = defaultScheduler;

/** Tests collect the counts to await them; pass nothing to restore the default. */
export function setToolCountScheduler(next?: CountScheduler): void {
  scheduler = next ?? defaultScheduler;
}

/**
 * Counts a call without holding up its answer: the MCP handler calls this and returns at once. A
 * count that fails is logged, never surfaced to the agent.
 */
export function scheduleToolCount(ctx: Ctx, tool: string, failed: boolean): void {
  scheduler(() => countToolCall(ctx, tool, failed).catch((error) => console.error("Could not count a tool call", error)));
}
