/**
 * Claude Code routines (cloud scheduled tasks) start a run when their API trigger's Fire URL is
 * POSTed with a bearer token. That endpoint takes `{ "text": ... }`, not Phean's JSON, and hands the
 * text to the run inside a `<routine-fire-payload>` block. A webhook registered at a Fire URL is
 * sent in that shape, so a routine can be an agent's webhook with nothing in between.
 */

/** The beta header the Fire URL requires while routines are in research preview. */
export const ROUTINE_BETA = "experimental-cc-routine-2026-04-01";
export const ROUTINE_API_VERSION = "2023-06-01";
/** Text past this is cut, keeping the summary lines; the run reads the rest from Phean. */
export const ROUTINE_TEXT_MAX = 16_000;

const FIRE_PATH = /^\/v1\/claude_code\/routines\/[A-Za-z0-9_-]+\/fire$/;

/** Whether a webhook URL is a routine's Fire URL (copied from its API trigger in claude.ai/code/routines). */
export function isRoutineFireUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "api.anthropic.com" && !parsed.port && !parsed.search && FIRE_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** The headers a Fire URL needs besides the routine's own token; the webhook's headers can override them. */
export const ROUTINE_HEADERS: Readonly<Record<string, string>> = { "anthropic-beta": ROUTINE_BETA, "anthropic-version": ROUTINE_API_VERSION };

interface PayloadLike {
  type?: string;
  workspace?: { name?: string };
  agent?: { name?: string };
  events?: { summary?: string; reasons?: string[]; url?: string }[];
}

/**
 * Phean's payload as a routine run reads it: what happened, a line per event with its link, then
 * the payload itself. The run should treat it as a nudge and read the current state from Phean.
 */
export function routineText(body: string): string {
  let payload: PayloadLike;
  try {
    payload = JSON.parse(body) as PayloadLike;
  } catch {
    return body.slice(0, ROUTINE_TEXT_MAX);
  }
  const events = payload.events ?? [];
  const who = `${payload.agent?.name ?? "your agent"} in ${payload.workspace?.name ?? "Phean"}`;
  const head =
    payload.type === "phean.ping"
      ? `Phean webhook test (ping) for ${who}. Nothing to do.`
      : `Phean: ${events.length} ${events.length === 1 ? "change" : "changes"} for ${who}. This is a nudge: read the current state from Phean (collect_answers, get_task) before you act.`;
  const lines = events.map((event) => `- ${event.summary ?? ""}${event.reasons?.length ? ` [${event.reasons.join(", ")}]` : ""}${event.url ? ` ${event.url}` : ""}`);
  const summary = [head, ...lines].join("\n");
  const whole = `${summary}\n\nPayload:\n${body}`;
  if (whole.length <= ROUTINE_TEXT_MAX) return whole;
  return `${summary.slice(0, ROUTINE_TEXT_MAX - 80)}\n\n(Payload left out for length; call get_activity for the rest.)`;
}

/** The request body for a Fire URL. */
export function routineBody(body: string): string {
  return JSON.stringify({ text: routineText(body) });
}
