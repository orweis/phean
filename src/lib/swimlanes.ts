import type { InputRequest } from "./agent-sessions";

/** The board's two horizontal lanes: work that waits on people, and work agents carry. */
export const SWIMLANES = ["people", "agents"] as const;
export type Swimlane = (typeof SWIMLANES)[number];

export const SWIMLANE_META: Record<Swimlane, { label: string; hint: string }> = {
  people: { label: "People", hint: "Waiting on you or another person" },
  agents: { label: "Agents", hint: "Held or managed by agents" },
};

interface Placeable {
  inputRequest: InputRequest | null;
  claimedByAgentId: string | null;
  operatorUserId: string | null;
  delegateToUserId: string | null;
  createdByType: "user" | "agent";
}

/**
 * Which lane a task rides in. A task an agent is waiting on a person for, a person is working on,
 * or one being handed to a person is people's work; otherwise an agent operating it, or an agent
 * having captured it, makes it agents' work; the rest (captured by a person, with no operator) is
 * people's.
 */
export function swimlaneOf(task: Placeable): Swimlane {
  if (task.inputRequest || task.operatorUserId || task.delegateToUserId) return "people";
  if (task.claimedByAgentId) return "agents";
  return task.createdByType === "agent" ? "agents" : "people";
}

/** Whether a person sees the board split into the People and Agents rows; kept per browser in a cookie. */
export const BOARD_ROWS_COOKIE = "phean-board-rows";
export const BOARD_ROWS = ["split", "single"] as const;
export type BoardRows = (typeof BOARD_ROWS)[number];

export function parseBoardRows(value: string | undefined): BoardRows {
  return value === "single" ? "single" : "split";
}

/** A `document.cookie` assignment that keeps the choice for a year on this origin. */
export function boardRowsCookie(rows: BoardRows, secure: boolean): string {
  return [`${BOARD_ROWS_COOKIE}=${rows}`, "Path=/", `Max-Age=${60 * 60 * 24 * 365}`, "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
}
