import { isValidElement, type ReactNode } from "react";

import { SKILLS, type EventParams } from "./analytics";

/** A heading's words without its Markdown: code ticks, emphasis, and link targets. */
export function plainHeading(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .trim();
}

/** The anchor of a docs heading, the same from its Markdown (the outline) and its rendered text (the heading). */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");
}

/** The text a rendered heading shows, through any code or emphasis inside it. */
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

// ---------------------------------------------------------------------------------------------------
// Analytics (docs/ANALYTICS.md, "Docs"): what a docs page and a copied block are, as catalog values only
// ---------------------------------------------------------------------------------------------------

type SetupClient = NonNullable<EventParams<"client_setup_view">["client"]>;
type CopiedBlock = NonNullable<EventParams<"docs_copy">["block"]>;

/**
 * The client a docs page sets up, by its slug, or by a heading's anchor on a page that sets up several
 * (connect-an-agent's `#claude-code`, `#cursor`, `#vs-code`, which share the client pages' slugs).
 */
const SETUP_CLIENTS: Readonly<Record<string, SetupClient>> = {
  "claude-code": "claude_code",
  "claude-apps": "claude_desktop",
  cursor: "cursor",
  "vs-code": "vscode",
  "chatgpt-dots": "chatgpt",
  grok: "other",
  muse: "other",
  instinct: "other",
  "your-own-bot": "other",
};

export function setupClientOf(slugOrAnchor: string): SetupClient | undefined {
  return Object.hasOwn(SETUP_CLIENTS, slugOrAnchor) ? SETUP_CLIENTS[slugOrAnchor] : undefined;
}

/** The skills a block installs (`skills/phean-decisions` in a `cp` or a zip), in catalog order. */
export function skillsIn(text: string): (typeof SKILLS)[number][] {
  return SKILLS.filter((skill) => new RegExp(`skills/${skill}(?![\\w-])`).test(text));
}

const SHELL = new Set(["bash", "sh", "shell", "zsh", "console"]);

/**
 * What a copied docs block is, from its text and its fence's language. The text is read here and
 * never sent: a command that installs a skill or adds the MCP server is `install_command`, a URL or
 * client config pointing at `/mcp` is `mcp_url`, prose for an agent (a plain-text fence) is `prompt`,
 * and the rest is `code`. Inline code is never a prompt.
 */
export function copiedBlockOf(text: string, lang: string | undefined, inline = false): CopiedBlock {
  const trimmed = text.trim();
  const shell = lang !== undefined && SHELL.has(lang);
  if (skillsIn(trimmed).length > 0 || (shell && /\bmcp add\b/.test(trimmed))) return "install_command";
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(trimmed);
  if (/\/mcp(\/w\/|["'\s]|$)/m.test(trimmed) && (isUrl || lang === "json")) return "mcp_url";
  if (!inline && (lang === undefined || lang === "text") && !isUrl) return "prompt";
  return "code";
}
