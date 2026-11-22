import { AGENT_ACCESS_LEVELS, LIMITS, type AgentAccessLevel } from "./domain";

/** What authorize adds when it signs a request; a re-run gets its own. */
const SIGNATURE_PARAMS = ["sig", "exp", "ba_iat", "ba_pl", "ba_param"];

/** These send a person to sign-in. Once they have signed in they are answered, and keeping them would loop. */
const SIGN_IN_PROMPTS = new Set(["login", "create", "select_account"]);

/**
 * Authorize, for the request behind a signed query. It is how a person gets back to the dialog
 * after signing in or after the signature expires. Authorize checks everything again, so nothing
 * from the query is trusted here.
 */
export function authorizeRetryPath(query: string): string {
  const params = new URLSearchParams(query);
  for (const name of SIGNATURE_PARAMS) params.delete(name);
  params.delete("max_age");
  const prompts = (params.get("prompt") ?? "").split(" ").filter((prompt) => prompt && !SIGN_IN_PROMPTS.has(prompt));
  if (prompts.length) params.set("prompt", prompts.join(" "));
  else params.delete("prompt");
  return `/api/auth/oauth2/authorize?${params}`;
}

/** Custom schemes are open-ended, so this names the ones a browser must never be sent to. */
const UNSAFE_REDIRECT_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "filesystem:", "view-source:"]);

const LOOPBACK_IPV4 = /^127(\.\d{1,3}){3}$/;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]" || LOOPBACK_IPV4.test(hostname);
}

export interface RedirectTarget {
  /** What the dialog shows: the host of a web address, or the scheme and host of an app's. */
  label: string;
  /** The address is on the person's own computer, so any local program could be behind it. */
  loopback: boolean;
}

/** Where a redirect address leads, as the browser would read it, or null if a browser must not go there. */
export function redirectTarget(redirectUri: string): RedirectTarget | null {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  if (UNSAFE_REDIRECT_SCHEMES.has(url.protocol)) return null;
  if (url.protocol === "http:" || url.protocol === "https:") return { label: url.hostname, loopback: isLoopbackHostname(url.hostname) };
  return { label: url.host ? `${url.protocol}//${url.host}` : url.protocol, loopback: false };
}

/**
 * A client's own name, safe to show and to prefill. It is hostile input: control and direction
 * characters could disguise it, and the agent name it becomes has a limit.
 */
export function clientDisplayName(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/\p{C}/gu, "")
    .trim()
    .slice(0, LIMITS.name)
    // The cut may land inside an emoji.
    .replace(/[\uD800-\uDBFF]$/, "")
    .trim();
}

const LEVEL_SCOPE_PREFIX = "phean:";

/**
 * What a token's `scope` says for the chosen level: the requested scopes at or below it, and
 * `offline_access`. It is a hint, since the agents row decides real access, but it never names a
 * level above the chosen one. Consent refuses an empty scope and one that was not requested, so:
 * `offline_access` alone when every level requested is above the chosen one; undefined, leaving the
 * request as it stands, when it names no level; and null when it names only levels above the chosen
 * one and nothing else, which no token can honestly carry.
 */
export function consentScope(requested: string | null | undefined, level: AgentAccessLevel): string | null | undefined {
  const allowed = AGENT_ACCESS_LEVELS.slice(0, AGENT_ACCESS_LEVELS.indexOf(level) + 1).map((name) => `${LEVEL_SCOPE_PREFIX}${name}`);
  const scopes = (requested ?? "").split(" ").filter(Boolean);
  if (!scopes.some((scope) => scope.startsWith(LEVEL_SCOPE_PREFIX))) return undefined;
  const kept = scopes.filter((scope) => scope === "offline_access" || allowed.includes(scope));
  return kept.length ? kept.join(" ") : null;
}

/** The levels a request's scope names, lowest first: empty when it names none. */
export function requestedLevels(requested: string | null | undefined): AgentAccessLevel[] {
  const scopes = (requested ?? "").split(" ");
  return AGENT_ACCESS_LEVELS.filter((level) => scopes.includes(`${LEVEL_SCOPE_PREFIX}${level}`));
}

/** The levels a token for this request can be issued at: those `consentScope` has an honest scope for. */
export function issuableLevels(requested: string | null | undefined): AgentAccessLevel[] {
  return AGENT_ACCESS_LEVELS.filter((level) => consentScope(requested, level) !== null);
}

/**
 * Identifies a choice of workspace and name, so a warning about replacing a connection is tied to
 * that choice. A slug never holds "/", and a form post would turn a newline into CRLF.
 */
export function renewalKey(workspaceSlug: string, name: string): string {
  return `${workspaceSlug}/${name.trim()}`;
}

/** The dialog's choice of agent when the person connects a new one rather than reconnecting their own. */
export const NEW_AGENT = "new";

/** One of the person's own agents in a workspace, as the dialog shows it. Its id is checked again on the server. */
export interface ConsentAgent {
  id: string;
  name: string;
  /** It was last approved for the client asking now. */
  sameClient: boolean;
  /** Its access has lapsed; reconnecting renews it. */
  expired: boolean;
  /** Its live sub-agents' names. */
  subagents: readonly string[];
  /** Open tasks it or its sub-agents have claimed. */
  openClaims: number;
}

/** Names as people read them: case and runs of spaces do not matter. */
const looseName = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * What a typed name for a new agent runs into among the person's own agents: the agent that already
 * has it (approving renews that one, as the server's index compares names exactly), and the agents
 * one of whose sub-agents goes by it.
 */
export function nameConflicts<A extends Pick<ConsentAgent, "name" | "subagents">>(agents: readonly A[], typed: string): { agent: A | undefined; parentsOf: A[] } {
  const name = typed.trim();
  if (!name) return { agent: undefined, parentsOf: [] };
  return {
    agent: agents.find((agent) => agent.name === name),
    parentsOf: agents.filter((agent) => agent.subagents.some((sub) => looseName(sub) === looseName(name))),
  };
}

/** What the dialog says about one of the person's agents: its sub-agents, its claims, and where it last connected from. */
export function consentAgentDetails(agent: ConsentAgent): string {
  const parts = [
    agent.subagents.length ? `Sub-agent${agent.subagents.length === 1 ? "" : "s"}: ${agent.subagents.join(", ")}` : "No sub-agents",
    agent.openClaims === 1 ? "1 open claim" : `${agent.openClaims} open claims`,
    agent.sameClient ? "last connected from this client" : "last connected from another client",
    ...(agent.expired ? ["access ended"] : []),
  ];
  return parts.join(" · ");
}

/** The form field for one workspace's access level. Each row is its own radio group, so arrow keys stay in it. */
export function levelField(workspaceSlug: string): string {
  return `level:${workspaceSlug}`;
}

/** "resume" returns to the dialog through authorize; the others have answered the client. */
export type ConsentOutcome = "allowed" | "declined" | "resume";

/**
 * What the dialog says while the browser goes on. "resume" covers both a signed-out person, who goes
 * to sign-in, and a request past its time limit, which authorize simply signs again.
 */
export function consentLeavingText(outcome: ConsentOutcome, clientName: string): string {
  switch (outcome) {
    case "allowed":
      return `Connected. Go back to ${clientName}. You can close this window.`;
    case "declined":
      return "Cancelled. Nothing was connected. You can close this window.";
    case "resume":
      return "Starting the request again.";
  }
}
