import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isDocSlug } from "@/server/docs";
import { byRecency, leadPost, loadAuthors, loadPosts, parsePost, relatedPosts, tagsOf, type BlogAuthor } from "@/server/blog";

const posts = await loadPosts();
const authors = await loadAuthors();
const AUTHOR: BlogAuthor = { slug: "a", name: "A Writer", bio: "Writes." };

const source = (fields: Record<string, string>, body = "Intro.\n\n## One\n\nText.\n\n## Two\n\nMore.") =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n${body}`;
const VALID = { title: "A title: with a colon", description: "A summary.", date: "2026-11-20", author: "a", tags: "agent fleets, Decisions", cover: "capture" };

describe("the blog", () => {
  it("reads every post in content/blog", () => {
    const files = readdirSync(join(process.cwd(), "content", "blog")).filter((file) => file.endsWith(".md"));
    expect(posts.map((post) => post.slug).sort()).toEqual(files.map((file) => file.replace(/\.md$/, "")).sort());
    expect(posts.length).toBeGreaterThan(0);
  });

  it("parses a post's frontmatter, tags, outline and reading time", () => {
    const post = parsePost("p", source(VALID), [AUTHOR]);
    expect(post).toMatchObject({ title: "A title: with a colon", date: "2026-11-20", cover: "capture", featured: false, author: AUTHOR, readingMinutes: 1 });
    expect(post.tags).toEqual([
      { slug: "agent-fleets", name: "Agent fleets" },
      { slug: "decisions", name: "Decisions" },
    ]);
    expect(post.outline.map((entry) => entry.id)).toEqual(["one", "two"]);
    expect(post.body).not.toMatch(/^---/);
  });

  it("refuses a post with a missing field, an unknown author, a bad date or a cover that is not an illustration", () => {
    expect(() => parsePost("p", source({ ...VALID, title: "" }), [AUTHOR])).toThrow(/no title/);
    expect(() => parsePost("p", source({ ...VALID, author: "nobody" }), [AUTHOR])).toThrow(/author/);
    expect(() => parsePost("p", source({ ...VALID, date: "20 Nov 2026" }), [AUTHOR])).toThrow(/date/);
    expect(() => parsePost("p", source({ ...VALID, cover: "nope" }), [AUTHOR])).toThrow(/cover/);
  });

  it("orders newest first and leads with the newest featured post", () => {
    const make = (slug: string, date: string, featured = false) => ({ ...parsePost(slug, source({ ...VALID, date, featured: String(featured) }), [AUTHOR]) });
    const sorted = [make("old", "2026-01-01", true), make("new", "2026-02-01"), make("same-day-featured", "2026-02-01", true)].sort(byRecency);
    expect(sorted.map((post) => post.slug)).toEqual(["same-day-featured", "new", "old"]);
    expect(leadPost(sorted)?.slug).toBe("same-day-featured");
  });

  it("suggests other posts sharing the most tags, never the post itself", () => {
    for (const post of posts) {
      const next = relatedPosts(post, posts);
      expect(next).not.toContain(post);
      expect(next.length).toBe(Math.min(3, posts.length - 1));
    }
  });

  it("gives every post a writer with a bio, tags, and a title it leaves to the page", () => {
    for (const post of posts) {
      expect(authors).toContainEqual(post.author);
      expect(post.author.bio, post.slug).not.toBe("");
      expect(post.tags.length, post.slug).toBeGreaterThan(0);
      expect(post.body, post.slug).not.toMatch(/^# /m);
    }
    expect(tagsOf(posts).every((tag) => tag.count > 0)).toBe(true);
  });

  it("links only to docs pages that exist", () => {
    for (const post of posts) {
      for (const match of post.body.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1] ?? "";
        if (/^https?:/.test(target)) continue;
        const docs = /^\/docs(?:\/([a-z-]+))?(?:#.*)?$/.exec(target);
        expect(docs && isDocSlug(docs[1] ?? "index"), `${post.slug} links to ${target}`).toBe(true);
      }
    }
  });

  it("keeps the house style: no em or en dashes", () => {
    for (const post of posts) {
      const raw = readFileSync(join(process.cwd(), "content", "blog", `${post.slug}.md`), "utf8");
      expect(raw, post.slug).not.toMatch(/[–—]/);
    }
  });
});
