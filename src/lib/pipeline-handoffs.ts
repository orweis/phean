/**
 * Resending a pipeline stop's handoff that no one picked up. When the engine hands an agent stop's
 * subtask to an agent, the agent should hear `handed_to_you` and claim it. A bot that missed the
 * webhook (it was down, it dropped the request) would leave the run standing, so the pipelines tick
 * resends the handoff with exponential backoff: 3, 6, 12, 24 … minutes after the handoff, until 3
 * days have passed; then it stops and the stop is shown as stuck, for a person. Any pick-up, release,
 * completion or new handoff of the task ends it. Pure and client-safe: the engine schedules with
 * these, and the pages say "stuck since" with the same rule.
 */

const MINUTE = 60_000;

/** The first resend, in minutes after the handoff; each one after doubles the wait from the handoff. */
export const HANDOFF_RETRY_FIRST_MINUTES = 3;
/** How long after the handoff Phean keeps resending: 3 days. */
export const HANDOFF_RETRY_WINDOW_MINUTES = 3 * 24 * 60;

/** The automatic resends' times, in minutes after the handoff: 3, 6, 12, … while within the window. */
export function handoffRetryOffsets(): number[] {
  const offsets: number[] = [];
  for (let minutes = HANDOFF_RETRY_FIRST_MINUTES; minutes < HANDOFF_RETRY_WINDOW_MINUTES; minutes *= 2) offsets.push(minutes);
  return offsets;
}

/** When Phean stops resending a handoff made at `handedOffAt`. */
export function handoffGivesUpAt(handedOffAt: Date): Date {
  return new Date(handedOffAt.getTime() + HANDOFF_RETRY_WINDOW_MINUTES * MINUTE);
}

/**
 * The first automatic resend due after `after` for a handoff made at `handedOffAt`; null once none is
 * left in the window. A tick that ran late sends one resend and goes on to the next time still ahead,
 * never a burst for the times it missed.
 */
export function nextHandoffRetry(handedOffAt: Date, after: Date): Date | null {
  for (const minutes of handoffRetryOffsets()) {
    const at = new Date(handedOffAt.getTime() + minutes * MINUTE);
    if (at > after) return at;
  }
  return null;
}

/** Whole minutes from the handoff to `now`. */
export function minutesSince(handedOffAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - handedOffAt.getTime()) / MINUTE));
}

/** A wait in words: "12 minutes", "1 hour 36 minutes", "2 days 3 hours". */
export function waitInWords(minutes: number): string {
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (minutes < 60) return unit(minutes, "minute");
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    return [unit(hours, "hour"), minutes % 60 ? unit(minutes % 60, "minute") : ""].filter(Boolean).join(" ");
  }
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  return [unit(days, "day"), hours ? unit(hours, "hour") : ""].filter(Boolean).join(" ");
}

/** Why an automatic resend went out: "not picked up 12 minutes after the handoff". */
export function retryReason(handedOffAt: Date, now: Date): string {
  return `not picked up ${waitInWords(minutesSince(handedOffAt, now))} after the handoff`;
}

/** The handoff a stop's row records, and the task's current delegation, as `isStuckHandoff` reads them. */
export interface HandoffState {
  /** The stop is live (active or waiting) and current. */
  live: boolean;
  handedOffAt: Date | null;
  handoffAgentId: string | null;
  task: { delegation: string | null; delegateToAgentId: string | null; delegatedAt: Date | null } | null;
}

/** Whether the handoff the stop's row records is the one still waiting on its task: no one picked it up, let it go, or handed it on since. */
export function handoffStillWaiting(state: HandoffState): boolean {
  const { task } = state;
  return Boolean(
    state.live &&
      state.handedOffAt &&
      state.handoffAgentId &&
      task?.delegation === "handing_off" &&
      task.delegateToAgentId === state.handoffAgentId &&
      task.delegatedAt?.getTime() === state.handedOffAt.getTime(),
  );
}

/** Stuck: the handoff still waits, and the first resend's time has passed. */
export function isStuckHandoff(state: HandoffState, now: Date): boolean {
  return handoffStillWaiting(state) && now.getTime() - state.handedOffAt!.getTime() >= HANDOFF_RETRY_FIRST_MINUTES * MINUTE;
}
