/**
 * Deleting a workspace (`deleteWorkspace` in `server/domain/workspace-deletion.ts`): what the
 * Danger zone counts, the typed confirmation, and how recent a sign-in must be for a person
 * without a password. Client-safe, so the form and the service read the same rules.
 */

import { pluralize } from "./format";

/** What goes with a workspace, in the order the Danger zone lists it. */
export const DELETION_COUNTS = ["tasks", "goals", "decisions", "documents", "memories", "agents", "pipelines", "webhooks", "members"] as const;
export type DeletionCount = (typeof DELETION_COUNTS)[number];
export type DeletionCounts = Record<DeletionCount, number>;

const NOUNS: Record<DeletionCount, [string, string]> = {
  tasks: ["task", "tasks"],
  goals: ["goal", "goals"],
  decisions: ["decision", "decisions"],
  documents: ["document", "documents"],
  memories: ["memory", "memories"],
  agents: ["agent", "agents"],
  pipelines: ["pipeline", "pipelines"],
  webhooks: ["webhook", "webhooks"],
  members: ["member", "members"],
};

/** "3 tasks", "1 memory". */
export function countLabel(kind: DeletionCount, count: number): string {
  const [singular, plural] = NOUNS[kind];
  return pluralize(count, singular, plural);
}

/**
 * Someone who signs in only with GitHub or Google has no password to type again, so their session
 * must be this recent instead: they sign out and in, then delete.
 */
export const RECENT_SIGN_IN_MINUTES = 15;

/** Whether a session made at `signedInAt` is recent enough to stand in for a password. */
export function isRecentSignIn(signedInAt: Date, now: Date): boolean {
  const age = now.getTime() - signedInAt.getTime();
  return age <= RECENT_SIGN_IN_MINUTES * 60_000;
}

/** Whether what the owner typed names the workspace: its exact name or its exact slug. Blank never does. */
export function confirmsWorkspace(typed: string, workspace: { name: string; slug: string }): boolean {
  const value = typed.trim();
  return value.length > 0 && (value === workspace.name.trim() || value === workspace.slug);
}

/** The notice `/workspaces` shows once after a deletion, carried there in a short-lived cookie. */
export const DELETED_NOTICE_COOKIE = "phean-deleted-workspace";
export const DELETED_NOTICE_MAX_AGE = 60;

export function deletedNotice(name: string): string {
  return `Deleted workspace “${name}”`;
}
