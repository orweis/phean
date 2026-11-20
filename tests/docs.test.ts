import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { headingId, plainHeading } from "@/lib/docs";
import { DOC_SLUGS, isDocSlug, loadDoc, parseDoc, type DocPage } from "@/server/docs";
import { agentRole } from "@/server/domain/context";
import { PROMPTS } from "@/server/mcp/guidance";
import { toolAllowed } from "@/server/mcp/tool";
import { TOOLS } from "@/server/mcp/tools";
import { ROUTINE_API_VERSION, ROUTINE_BETA, ROUTINE_TEXT_MAX } from "@/server/webhooks/routines";

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

  it("quotes the headers and the text limit Phean sends a Claude Code routine", () => {
    const page = pages.find((candidate) => candidate.slug === "claude-code")!;
    expect(page.body).toContain(`anthropic-beta: ${ROUTINE_BETA}`);
    expect(page.body).toContain(`anthropic-version: ${ROUTINE_API_VERSION}`);
    expect(page.body).toContain(`${ROUTINE_TEXT_MAX.toLocaleString("en-US")} characters`);
  });

  it("keeps the README's tool counts, tool table and prompts in step with the server", () => {
    const readme = readFileSync("README.md", "utf8");
    const count = (level: "read" | "write" | "admin") => TOOLS.filter((tool) => toolAllowed(tool, { type: "agent", id: "", name: "", role: agentRole(level) })).length;
    const claim = /(\d+) tools for a Write agent \(fewer for Read, (\w+) more for Admin\) and (\d+) prompts/.exec(readme);
    expect(claim, "README states the tool counts").not.toBeNull();
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    expect(Number(claim![1])).toBe(count("write"));
    expect(count("read")).toBeLessThan(count("write"));
    expect(words[claim![2]!] ?? Number(claim![2])).toBe(count("admin") - count("write"));
    expect(Number(claim![3])).toBe(PROMPTS.length);
    for (const tool of TOOLS) expect(readme, tool.name).toContain(`\`${tool.name}\``);
    for (const prompt of PROMPTS) expect(readme, prompt.name).toContain(`\`${prompt.name}\``);
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
