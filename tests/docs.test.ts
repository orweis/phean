import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { headingId, plainHeading } from "@/lib/docs";
import { DOC_SLUGS, isDocSlug, loadDoc, parseDoc, type DocPage } from "@/server/docs";
import { TOOLS } from "@/server/mcp/tools";

const pages: DocPage[] = await Promise.all(DOC_SLUGS.map(loadDoc));

/** Every heading's anchor, `##` and `###`, as the page renders them. */
function anchorsOf(page: DocPage): Set<string> {
  const anchors = new Set<string>();
  let fenced = false;
  for (const line of page.body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? undefined : /^###? (.+)$/.exec(line)?.[1];
    if (heading) anchors.add(headingId(plainHeading(heading)));
  }
  return anchors;
}

describe("the docs site", () => {
  it("lists every page in content/docs, and only those", () => {
    const files = readdirSync(join(process.cwd(), "content", "docs")).map((file) => file.replace(/\.md$/, ""));
    expect([...files].sort()).toEqual([...DOC_SLUGS].sort());
  });

  it("gives every page a title and a description, and leaves the title to the page", () => {
    for (const page of pages) {
      expect(page.title, page.slug).not.toBe(page.slug);
      expect(page.description, page.slug).not.toBe("");
      expect(page.body.replace(/^```[\s\S]*?^```/gm, ""), page.slug).not.toMatch(/^# /m);
    }
  });

  it("links only to pages and headings that exist", () => {
    const anchors = new Map(pages.map((page) => [page.slug, anchorsOf(page)]));
    for (const page of pages) {
      for (const match of page.body.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1] ?? "";
        if (/^https?:/.test(target)) continue;
        const [path, hash] = target.split("#");
        const slug = path ? /^\/docs(?:\/([a-z-]+))?$/.exec(path)?.[1] ?? (path === "/docs" ? "index" : undefined) : page.slug;
        expect(slug && isDocSlug(slug), `${page.slug} links to ${target}`).toBe(true);
        if (hash) expect(anchors.get(slug as DocPage["slug"])?.has(hash), `${page.slug} links to ${target}`).toBe(true);
      }
    }
  });

  it("names every MCP tool in the reference", async () => {
    const reference = await loadDoc("mcp-reference");
    for (const tool of TOOLS) expect(reference.body, tool.name).toContain(`\`${tool.name}\``);
  });

  it("reads the frontmatter and outlines the page's sections, skipping code", () => {
    const page = parseDoc("index", "---\ntitle: A page\ndescription: What it says.\n---\nIntro\n\n## First `code` part\n\n```md\n## Not a heading\n```\n\n## Rotating `BETTER_AUTH_SECRET`\n");
    expect(page).toMatchObject({ title: "A page", description: "What it says." });
    expect(page.outline).toEqual([
      { id: "first-code-part", title: "First code part" },
      { id: "rotating-better_auth_secret", title: "Rotating BETTER_AUTH_SECRET" },
    ]);
  });
});
