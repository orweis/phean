import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import robots, { PRIVATE_PATHS } from "@/app/robots";
import sitemap from "@/app/sitemap";
import { AGENT_LINKS, DEVELOPER_LINKS, PRODUCT, RESOURCE_LINKS, USE_CASE_LINKS, anchorForUseCase } from "@/components/site/site-links";
import { USE_CASES } from "@/components/marketing/content";
import { routes } from "@/lib/routes";
import { loadPosts } from "@/server/blog";
import { isDocSlug } from "@/server/docs";

const GROUPS = [PRODUCT, USE_CASE_LINKS, AGENT_LINKS, DEVELOPER_LINKS, RESOURCE_LINKS];
const LANDING_ANCHORS = ["flip", "decisions", "assistants", "features", "get-started", "name", ...USE_CASES.map((useCase) => anchorForUseCase(useCase.key))];

describe("the site's navigation", () => {
  it("links only to pages and landing-page anchors that exist", () => {
    for (const link of GROUPS.flatMap((group) => group.links)) {
      if (link.external) {
        expect(link.href, link.label).toMatch(/^https:\/\//);
        continue;
      }
      const docs = /^\/docs(?:\/([a-z-]+))?$/.exec(link.href);
      if (docs) expect(isDocSlug(docs[1] ?? "index"), link.href).toBe(true);
      else if (link.href.startsWith("/#")) expect(LANDING_ANCHORS, link.href).toContain(link.href.slice(2));
      else expect(["/blog", "/blog/rss.xml", "/privacy", "/llms.txt"], link.href).toContain(link.href);
    }
  });

  it("names every link once per group, and describes every menu link", () => {
    for (const group of GROUPS) {
      const hrefs = group.links.map((link) => link.href);
      expect(new Set(hrefs).size, group.title).toBe(hrefs.length);
    }
    for (const link of [PRODUCT, USE_CASE_LINKS, AGENT_LINKS].flatMap((group) => group.links)) expect(link.description, link.label).toBeTruthy();
  });

  it("lists one use case link per use case on the landing page", () => {
    expect(USE_CASE_LINKS.links.map((link) => link.label)).toEqual(USE_CASES.map((useCase) => useCase.label));
  });
});

describe("crawlers", () => {
  it("lists every public page in the sitemap, and no app page", async () => {
    const urls = (await sitemap()).map((entry) => new URL(entry.url).pathname);
    expect(urls).toContain("/");
    expect(urls).toContain(routes.docs());
    expect(urls).toContain(routes.docs("mcp-reference"));
    expect(urls).toContain(routes.privacy());
    for (const post of await loadPosts()) expect(urls).toContain(routes.blog(post.slug));
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) expect(PRIVATE_PATHS.some((path) => url.startsWith(path)), url).toBe(false);
  });

  it("opens the public site to search and answer engines, keeps the app out, and points at the sitemap", () => {
    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules];
    for (const rule of rules) {
      expect(rule.allow).toBe("/");
      expect(rule.disallow).toEqual(expect.arrayContaining(["/w/", "/api/", "/oauth/", "/mcp"]));
    }
    expect(rules.flatMap((rule) => rule.userAgent)).toEqual(expect.arrayContaining(["*", "GPTBot", "ClaudeBot", "PerplexityBot"]));
    expect(config.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});

describe("the public site without the database", () => {
  const PUBLIC = ["src/app/page.tsx", "src/app/docs", "src/app/blog", "src/app/privacy", "src/components/site", "src/components/marketing"];
  const files = (path: string): string[] =>
    statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => files(join(path, name))) : /\.tsx?$/.test(path) ? [path] : [];

  it("never reads the database, so it stays up when the database is down", () => {
    const reaches = PUBLIC.flatMap(files).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [/@\/server\/db\b/, /@\/server\/domain\b/, /\b(getSession|getViewer|requireUser|requireWorkspace|getDb|lazyDb)\b/]
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${file}: ${pattern}`);
    });
    expect(reaches).toEqual([]);
  });
});
