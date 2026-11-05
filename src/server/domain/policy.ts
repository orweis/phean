import type { Actor, Ctx, Role } from "./context";
import { forbidden } from "./errors";

export const ACTIONS = [
  "workspace:read",
  "goal:write",
  "goal:decide",
  "task:write",
  "memory:write",
  "document:write",
  "agent:manage",
  "agent:delegate",
  "webhook:manage",
  "member:manage",
  "workflow:manage",
] as const;
export type Action = (typeof ACTIONS)[number];

const CONTRIBUTE: readonly Action[] = ["workspace:read", "goal:write", "task:write", "memory:write", "document:write"];

/**
 * The whole authorization model. `goal:decide` (approve, achieve, abandon) is human-only:
 * this is the server-side enforcement of "the agent proposes, the human disposes".
 */
const PERMISSIONS: Record<Role, readonly Action[]> = {
  owner: ACTIONS,
  admin: ACTIONS,
  member: [...CONTRIBUTE, "goal:decide"],
  // An agent registers and removes its own webhook; owners and admins can remove any agent's.
  // An agent registers its own webhook and issues tokens for its own sub-agents.
  agent: [...CONTRIBUTE, "agent:delegate", "webhook:manage"],
  platform_admin: ["workspace:read"],
};

const DENIAL_MESSAGES: Partial<Record<Action, string>> = {
  "goal:decide": "Only a human can approve, complete, or abandon a goal. Ask them to review it in the Phean web app.",
  "agent:manage": "Only workspace owners and admins can manage agent tokens.",
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
