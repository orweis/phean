import { track, type ClientEventName, type EventParams } from "./analytics";

/**
 * One catalog event to send when something has happened (an action succeeded, an undo ran, a filter
 * changed), typed against `EVENTS`: the shared primitives take it as their `analytics` prop, so call
 * sites name the event and its params and never call `track` around a form themselves.
 */
export type Tracked = { [N in ClientEventName]: { event: N; params?: EventParams<N> } }[ClientEventName];

/** One event, or several for an action that is two things at once (a goal added by hand is `goal_create` and `task_create_manual`). */
export type TrackedEvents = Tracked | readonly Tracked[];

/** Sends `Tracked` events, or nothing for null. Client-only, like `track`; never throws. */
export function sendTracked(spec: TrackedEvents | null | undefined): void {
  if (!spec) return;
  for (const one of Array.isArray(spec) ? (spec as readonly Tracked[]) : [spec as Tracked]) {
    (track as (name: ClientEventName, params?: Record<string, unknown>) => void)(one.event, one.params);
  }
}
