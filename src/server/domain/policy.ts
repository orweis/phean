import { ACTIONS, PERMISSIONS, type Action } from "@/lib/permissions";

import type { Actor, Ctx } from "./context";
import { forbidden } from "./errors";

export { ACTIONS, type Action };

const DENIAL_MESSAGES: Partial<Record<Action, string>> = {
  "goal:decide": "Only a human can approve, complete, or abandon a goal. Ask them to review it in the Phean web app.",
  "agent:manage": "Only workspace owners and admins, and agents with Admin access, can manage agents they did not connect themselves.",
  "agent:issue_key": "Only workspace owners and admins can issue agent keys. Connect the agent with OAuth instead.",
  "webhook:manage": "Only agents (for their own webhook) and workspace owners and admins can manage webhooks.",
  "member:manage": "Only workspace owners and admins can manage members.",
  "workflow:manage": "Only workspace owners and admins can change the board's stages.",
};

export function can(actor: Actor, action: Action): boolean {
  return PERMISSIONS[actor.role].includes(action);
}

export function assertCan(ctx: Ctx, action: Action): void {
  if (can(ctx.actor, action)) return;
  throw forbidden(DENIAL_MESSAGES[action] ?? `You do not have permission to perform "${action}" in this workspace.`);
}
