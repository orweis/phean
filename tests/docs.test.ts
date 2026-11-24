import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { copiedBlockOf, headingId, plainHeading, setupClientOf, skillsIn } from "@/lib/docs";
import { DOC_SECTIONS, DOC_SLUGS, docSectionOf, isDocSlug, loadDoc, parseDoc, type DocPage } from "@/server/docs";
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

describe("the docs site's analytics", () => {
  const agentPages: readonly string[] = DOC_SECTIONS.find((section) => section.title === "Agents")!.slugs;

  it("names the section each page sits in", () => {
    expect(docSectionOf("index")).toBe("start-here");
    expect(docSectionOf("cursor")).toBe("agents");
    expect(docSectionOf("webhooks")).toBe("building-on-phean");
  });

  it("maps every client's setup page, and connect-an-agent's client sections, to a client", () => {
    for (const slug of agentPages.filter((slug) => slug !== "agents")) expect(setupClientOf(slug), slug).toBeDefined();
    expect(setupClientOf("agents")).toBeUndefined();
    expect(setupClientOf("toString")).toBeUndefined();
    const connect = anchorsOf(pages.find((page) => page.slug === "connect-an-agent")!);
    expect(["claude-code", "cursor", "vs-code"].filter((anchor) => connect.has(anchor))).toHaveLength(3);
    expect(setupClientOf("vs-code")).toBe("vscode");
  });

  it("classifies the blocks the docs show, and the skills a block installs", () => {
    const blocks = pages.flatMap((page) => [...page.body.matchAll(/^\s*```(\w*)\n([\s\S]*?)^\s*```/gm)].map(([, lang, text]) => ({ slug: page.slug, lang: lang || undefined, text: text! })));
    const kinds = new Set(blocks.map((block) => copiedBlockOf(block.text, block.lang)));
    expect([...kinds].sort()).toEqual(["code", "install_command", "mcp_url", "prompt"]);

    expect(copiedBlockOf("claude mcp add --transport http phean-acme https://example.com/mcp/w/acme", "bash")).toBe("install_command");
    expect(copiedBlockOf("mkdir -p ~/.claude/skills && cp -r skills/phean-decisions skills/phean-handoffs ~/.claude/skills/", "bash")).toBe("install_command");
    expect(copiedBlockOf("https://<your-domain>/mcp/w/<slug>", "text")).toBe("mcp_url");
    expect(copiedBlockOf('{ "mcpServers": { "phean": { "url": "https://example.com/mcp/w/acme" } } }', "json")).toBe("mcp_url");
    expect(copiedBlockOf("Track work in Phean: sync up at the start of a session.", "text")).toBe("prompt");
    expect(copiedBlockOf("/mcp__phean-acme__sync_up", "text")).toBe("prompt");
    expect(copiedBlockOf("wss://<your-domain>/api/events", "text")).toBe("code");
    expect(copiedBlockOf("pnpm db:migrate && next build", "bash")).toBe("code");
    expect(copiedBlockOf("phean-decisions", undefined, true)).toBe("code");

    expect(skillsIn("cp -r skills/phean-pipelines skills/phean-decisions ~/.claude/skills/")).toEqual(["phean-decisions", "phean-pipelines"]);
    expect(skillsIn("skills/phean-decisions/SKILL.md")).toEqual(["phean-decisions"]);
    expect(skillsIn("skills/phean-decisions-old")).toEqual([]);
  });
});
