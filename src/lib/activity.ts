import { pluralize } from "./format";

/** Every action written to the activity log, with the phrase used when several are grouped. */
const ACTION_BATCH_PHRASES = {
  "goal.proposed": ["proposed", "goal"],
  "goal.created": ["created", "goal"],
  "goal.updated": ["updated", "goal"],
  "goal.approved": ["approved", "goal"],
  "goal.reactivated": ["reactivated", "goal"],
  "goal.achieved": ["achieved", "goal"],
  "goal.abandoned": ["abandoned", "goal"],
  "task.captured": ["captured", "task"],
  "task.updated": ["updated", "task"],
  "task.assigned": ["filed", "task"],
  "task.claimed": ["claimed", "task"],
  "task.released": ["released", "task"],
  "task.completed": ["completed", "task"],
  "memory.saved": ["saved", "memory"],
  "memory.forgotten": ["forgot", "memory"],
  "agent.created": ["connected", "agent"],
  "agent.revoked": ["revoked", "agent"],
  "member.invited": ["invited", "member"],
} as const satisfies Record<string, readonly [verb: string, noun: string]>;

export type EventAction = keyof typeof ACTION_BATCH_PHRASES;

export interface ActivityLike {
  id: number;
  actorType: string;
  actorId: string;
  actorName: string;
  action: string;
  summary: string;
  createdAt: Date;
}

export interface ActivityGroup<E extends ActivityLike> {
  key: string;
  events: E[];
  /** The most recent event in the group (activity is listed newest first). */
  latest: E;
  summary: string;
}

const GROUP_WINDOW_MS = 10 * 60 * 1000;

function batchSummary(action: string, count: number): string | null {
  const phrase = ACTION_BATCH_PHRASES[action as EventAction];
  if (!phrase) return null;
  const [verb, noun] = phrase;
  return `${verb} ${pluralize(count, noun, noun === "memory" ? "memories" : undefined)}`;
}

/**
 * Collapses runs of the same actor doing the same thing within a few minutes,
 * so "captured 12 tasks" reads as one line instead of twelve.
 * Expects events newest first and preserves that order.
 */
export function groupActivity<E extends ActivityLike>(events: readonly E[]): ActivityGroup<E>[] {
  const groups: ActivityGroup<E>[] = [];
  for (const event of events) {
    const current = groups.at(-1);
    const oldest = current?.events.at(-1);
    const continues =
      current &&
      oldest &&
      oldest.actorId === event.actorId &&
      oldest.action === event.action &&
      oldest.createdAt.getTime() - event.createdAt.getTime() <= GROUP_WINDOW_MS;

    if (continues) {
      current.events.push(event);
      current.summary = batchSummary(event.action, current.events.length) ?? current.summary;
    } else {
      groups.push({ key: `${event.id}`, events: [event], latest: event, summary: event.summary });
    }
  }
  return groups;
}
