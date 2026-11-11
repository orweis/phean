/**
 * The authorization matrix, as plain data so the server's `policy.ts` and client-safe code such as
 * `grantableLevels` read the same table. Enforcement stays in `policy.ts` (`assertCan`).
 */
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
  "digest:subscribe",
] as const;
export type Action = (typeof ACTIONS)[number];

export type PolicyRole = "owner" | "admin" | "member" | "platform_admin" | "agent_read" | "agent_write" | "agent_admin";

const CONTRIBUTE: readonly Action[] = ["workspace:read", "goal:write", "task:write", "memory:write", "document:write"];

/**
 * The whole authorization model. `goal:decide` (approve, achieve, abandon) is human-only:
 * this is the server-side enforcement of "the agent proposes, the human disposes".
 */
export const PERMISSIONS: Record<PolicyRole, readonly Action[]> = {
  owner: ACTIONS,
  admin: ACTIONS,
  // Members approve agents they connect, up to Write.
  member: [...CONTRIBUTE, "goal:decide", "agent:connect", "digest:subscribe"],
  // A Read agent only looks. A Write agent registers its own webhook and issues tokens for its own
  // sub-agents; owners and admins can remove any agent's webhook. An Admin agent also manages agents.
  // The morning digest is mail to a person; no agent subscribes to one.
  agent_read: ["workspace:read"],
  agent_write: [...CONTRIBUTE, "agent:delegate", "webhook:manage"],
  agent_admin: [...CONTRIBUTE, "agent:delegate", "webhook:manage", "agent:manage"],
  platform_admin: ["workspace:read"],
};

/** Whether a role, by name, holds an action. A name the matrix does not know holds nothing. */
export function roleCan(role: string, action: Action): boolean {
  return Object.hasOwn(PERMISSIONS, role) && PERMISSIONS[role as PolicyRole].includes(action);
}
