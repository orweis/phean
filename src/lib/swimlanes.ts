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
  createdByType: "user" | "agent";
}

/**
 * Which lane a task rides in. A task an agent is waiting on a person for is people's work, whoever
 * holds it; otherwise an agent holding it, or an agent having captured it, makes it agents' work;
 * the rest (captured by a person, held by no agent) is people's.
 */
export function swimlaneOf(task: Placeable): Swimlane {
  if (task.inputRequest) return "people";
  if (task.claimedByAgentId) return "agents";
  return task.createdByType === "agent" ? "agents" : "people";
}
