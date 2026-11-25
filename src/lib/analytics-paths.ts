/**
 * What Google Analytics is told about where a person is: the route pattern, never the address. A
 * workspace's slug, a task's id, an invitation, an OAuth request and a search query never leave the
 * browser (docs/ANALYTICS.md, "Redaction"). Pure, so the tests can run every route through it.
 */

export const SURFACES = ["marketing", "docs", "blog", "auth", "app", "oauth"] as const;
export type Surface = (typeof SURFACES)[number];

/** Segments under `/w/[slug]` that are page names; every other segment there is an id. */
const WORKSPACE_SEGMENTS = new Set([
  "decisions",
  "quick",
  "board",
  "timeline",
  "goals",
  "tasks",
  "memory",
  "pipelines",
  "runs",
  "documents",
  "file",
  "search",
  "digest",
  "agents",
  "members",
  "settings",
  "link",
  "suggest",
  "push",
  "answer",
  "undo",
]);

/** Pages outside the workspaces whose deeper segments are page names, not ids or tokens. */
const STATIC_SEGMENTS = new Set(["two-factor", "reset-password", "forgot-password", "approve", "authorize", "confirm", "consent", "new"]);

/** A public page's slug (a doc, a post, a tag, a writer) is public: keep it when it looks like one. */
const PUBLIC_SLUG = /^[a-z0-9][a-z0-9-]{0,80}(\.xml|\.txt)?$/;

/** Query keys kept on public pages: campaign tags only. A search term (`q`) is never sent. */
const PUBLIC_QUERY = /^(utm_[a-z_]+|ref)$/;

export interface RedactedLocation {
  /** The route pattern, e.g. `/w/[slug]/tasks/[id]`. */
  template: string;
  /** The path sent as `page_path`: the pattern, or a public page's own path. */
  path: string;
  /** The query string kept (with its `?`), or "". */
  search: string;
  surface: Surface;
}

function segmentsOf(pathname: string): string[] {
  return pathname.split(/[?#]/)[0]!.split("/").filter(Boolean);
}

function surfaceOf(first: string | undefined): Surface {
  switch (first) {
    case undefined:
    case "privacy":
      return "marketing";
    case "docs":
    case "llms.txt":
    case "llms-full.txt":
      return "docs";
    case "blog":
      return "blog";
    case "sign-in":
    case "sign-up":
    case "invite":
    case "native":
      return "auth";
    case "oauth":
      return "oauth";
    default:
      return "app";
  }
}

function workspacePattern(rest: string[]): string {
  if (rest.length === 0) return "/w";
  return ["/w/[slug]", ...rest.slice(1).map((segment) => (WORKSPACE_SEGMENTS.has(segment) ? segment : "[id]"))].join("/");
}

function patternOf(segments: string[]): string {
  const [first, ...rest] = segments;
  if (first === undefined) return "/";
  if (first === "w") return workspacePattern(rest);
  if (first === "invite") return rest.length ? "/invite/[id]" : "/invite";
  if (first === "docs" || first === "blog") return ["", first, ...rest.map((segment) => (PUBLIC_SLUG.test(segment) ? segment : "[other]"))].join("/");
  const known = ["privacy", "sign-in", "sign-up", "account", "workspaces", "oauth", "native", "offline", "llms.txt", "llms-full.txt"];
  if (!known.includes(first)) return "/[other]";
  return ["", first, ...rest.map((segment) => (STATIC_SEGMENTS.has(segment) ? segment : "[id]"))].join("/");
}

function keptQuery(search: string, surface: Surface): string {
  if (surface !== "marketing" && surface !== "docs" && surface !== "blog") return "";
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if (PUBLIC_QUERY.test(key)) kept.append(key, value.slice(0, 100));
  }
  const query = kept.toString();
  return query ? `?${query}` : "";
}

/** The redacted location for a pathname and its query string (`search`, with or without its `?`). */
export function redactLocation(pathname: string, search = ""): RedactedLocation {
  const segments = segmentsOf(pathname);
  const surface = surfaceOf(segments[0]);
  const template = patternOf(segments);
  return { template, path: template, search: keptQuery(search, surface), surface };
}

/** A referrer GA may see: another site's origin only, or a redacted page of this one. */
export function redactReferrer(referrer: string, origin: string): string | undefined {
  if (!referrer) return undefined;
  try {
    const url = new URL(referrer);
    if (url.origin !== origin) return `${url.origin}/`;
    const { path } = redactLocation(url.pathname);
    return `${origin}${path}`;
  } catch {
    return undefined;
  }
}
