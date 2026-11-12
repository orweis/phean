import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

import { headingId, plainHeading } from "@/lib/docs";

/** The docs site's pages, in reading order, under the sidebar's sections. `index` is the site's front page at `/docs`. */
export const DOC_SECTIONS = [
  { title: "Start here", slugs: ["index", "getting-started", "connect-an-agent"] },
  { title: "Agents", slugs: ["agents", "claude-code", "claude-apps", "cursor", "vs-code", "grok", "chatgpt-dots", "muse", "instinct", "your-own-bot"] },
  { title: "Using Phean", slugs: ["concepts", "the-agent-loop", "decisions", "sub-agents", "documents"] },
  { title: "Building on Phean", slugs: ["webhooks", "realtime", "mcp-reference", "skills"] },
  { title: "Running Phean", slugs: ["self-hosting", "security"] },
] as const;

export type DocSlug = (typeof DOC_SECTIONS)[number]["slugs"][number];

export const DOC_SLUGS: readonly DocSlug[] = DOC_SECTIONS.flatMap((section) => section.slugs);

export interface DocPage {
  slug: DocSlug;
  title: string;
  description: string;
  body: string;
  /** The page's `##` sections, for its table of contents. */
  outline: { id: string; title: string }[];
}

const CONTENT = path.join(process.cwd(), "content", "docs");

export function isDocSlug(slug: string): slug is DocSlug {
  return (DOC_SLUGS as readonly string[]).includes(slug);
}

/** Splits a page's `---` frontmatter (`title:` and `description:` lines only) from its Markdown body. */
export function parseDoc(slug: DocSlug, source: string): DocPage {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  const fields = new Map<string, string>();
  for (const line of (match?.[1] ?? "").split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const body = match ? source.slice(match[0].length) : source;
  const outline: DocPage["outline"] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? undefined : /^## (.+)$/.exec(line)?.[1];
    if (heading) outline.push({ id: headingId(plainHeading(heading)), title: plainHeading(heading) });
  }
  return { slug, title: fields.get("title") ?? slug, description: fields.get("description") ?? "", body, outline };
}

/** One docs page, read from `content/docs/<slug>.md`. */
export const loadDoc = cache(async (slug: DocSlug): Promise<DocPage> => parseDoc(slug, await readFile(path.join(CONTENT, `${slug}.md`), "utf8")));

/** Every page's title and description, for the sidebar and the index. */
export const loadDocIndex = cache(async () => Promise.all(DOC_SLUGS.map(loadDoc)));
