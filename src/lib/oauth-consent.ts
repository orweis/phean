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
 * `offline_access`. It is a hint, since the agents row decides real access. Undefined leaves the
 * request as it stands: consent refuses an empty scope, and may not add one that was not requested.
 */
export function consentScope(requested: string | null | undefined, level: AgentAccessLevel): string | undefined {
  const allowed = AGENT_ACCESS_LEVELS.slice(0, AGENT_ACCESS_LEVELS.indexOf(level) + 1).map((name) => `${LEVEL_SCOPE_PREFIX}${name}`);
  const kept = (requested ?? "").split(" ").filter((scope) => scope === "offline_access" || allowed.includes(scope));
  return kept.some((scope) => scope !== "offline_access") ? kept.join(" ") : undefined;
}

/**
 * Identifies a choice of workspace and name, so a warning about replacing a connection is tied to
 * that choice. A slug never holds "/", and a form post would turn a newline into CRLF.
 */
export function renewalKey(workspaceSlug: string, name: string): string {
  return `${workspaceSlug}/${name.trim()}`;
}
