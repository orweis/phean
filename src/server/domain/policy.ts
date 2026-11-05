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
  "agent:connect",
  "agent:issue_key",
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
  // Members approve agents they connect, up to Write.
  member: [...CONTRIBUTE, "goal:decide", "agent:connect"],
  // A Read agent only looks. A Write agent registers its own webhook and issues tokens for its own
  // sub-agents; owners and admins can remove any agent's webhook. An Admin agent also manages agents.
  agent_read: ["workspace:read"],
  agent_write: [...CONTRIBUTE, "agent:delegate", "webhook:manage"],
  agent_admin: [...CONTRIBUTE, "agent:delegate", "webhook:manage", "agent:manage"],
  platform_admin: ["workspace:read"],
};

const DENIAL_MESSAGES: Partial<Record<Action, string>> = {
  "goal:decide": "Only a human can approve, complete, or abandon a goal. Ask them to review it in the Phean web app.",
  "agent:manage": "Only workspace owners and admins can manage agent tokens.",
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
