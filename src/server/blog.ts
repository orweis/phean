import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

import type { ArtId } from "@/components/marketing/art";
import manifest from "../../public/marketing/manifest.json";
import { headingId, plainHeading } from "@/lib/docs";

/*
 * The blog: one Markdown file per post in content/blog (`<slug>.md`), and the people who write them in
 * content/blog/authors.json. Like the docs, it is read from disk at build time; no CMS. A post's cover is
 * one of the site's illustrations (public/marketing/manifest.json), named by its id.
 */

export interface BlogAuthor {
  slug: string;
  name: string;
  bio: string;
  /** A square photo under public/, or none for an initial on a disc. */
  image?: string;
  linkedin?: string;
  x?: string;
}

export interface BlogTag {
  slug: string;
  name: string;
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  /** The day it was published, `YYYY-MM-DD`, a UTC calendar day. */
  date: string;
  author: BlogAuthor;
  tags: BlogTag[];
  cover: ArtId;
  /** Leads the blog's front page. The newest featured post wins. */
  featured: boolean;
  body: string;
  /** The post's `##` sections, for its table of contents. */
  outline: { id: string; title: string }[];
  /** Whole minutes at 230 words a minute, at least one. */
  readingMinutes: number;
}

const CONTENT = path.join(process.cwd(), "content", "blog");
const ART_IDS = new Set((manifest as { id: string }[]).map((entry) => entry.id));
export const BLOG_PAGE_SIZE = 12;

/** A tag's name as a URL segment: "Agent fleets" is `agent-fleets`. */
export function tagSlug(name: string): string {
  return headingId(name);
}

/** Splits a post's `---` frontmatter (one `key: value` per line) from its Markdown body. */
export function parseFrontmatter(source: string): { fields: Map<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  const fields = new Map<string, string>();
  for (const line of (match?.[1] ?? "").split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return { fields, body: match ? source.slice(match[0].length) : source };
}

function outlineOf(body: string): BlogPost["outline"] {
  const outline: BlogPost["outline"] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? undefined : /^## (.+)$/.exec(line)?.[1];
    if (heading) outline.push({ id: headingId(plainHeading(heading)), title: plainHeading(heading) });
  }
  return outline;
}

/** One post from its file, with its author resolved. Throws on a missing field, so a broken post fails the build. */
export function parsePost(slug: string, source: string, authors: BlogAuthor[]): BlogPost {
  const { fields, body } = parseFrontmatter(source);
  const need = (key: string) => {
    const value = fields.get(key);
    if (!value) throw new Error(`Blog post "${slug}" has no ${key}`);
    return value;
  };
  const date = need("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Blog post "${slug}" has a date that is not YYYY-MM-DD: ${date}`);
  const authorSlug = need("author");
  const author = authors.find((candidate) => candidate.slug === authorSlug);
  if (!author) throw new Error(`Blog post "${slug}" names an author not in authors.json: ${authorSlug}`);
  const cover = need("cover");
  if (!ART_IDS.has(cover)) throw new Error(`Blog post "${slug}" has a cover that is not an illustration: ${cover}`);
  const tags = (fields.get("tags") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ slug: tagSlug(name), name: name.charAt(0).toUpperCase() + name.slice(1) }));
  const words = body.split(/\s+/).filter(Boolean).length;
  return {
    slug,
    title: need("title"),
    description: need("description"),
    date,
    author,
    tags,
    cover: cover as ArtId,
    featured: fields.get("featured") === "true",
    body,
    outline: outlineOf(body),
    readingMinutes: Math.max(1, Math.round(words / 230)),
  };
}

/** Newest first; on the same day, featured first, then by title. */
export function byRecency(a: BlogPost, b: BlogPost): number {
  return b.date.localeCompare(a.date) || Number(b.featured) - Number(a.featured) || a.title.localeCompare(b.title);
}

export const loadAuthors = cache(async (): Promise<BlogAuthor[]> => JSON.parse(await readFile(path.join(CONTENT, "authors.json"), "utf8")) as BlogAuthor[]);

/** Every post, newest first. */
export const loadPosts = cache(async (): Promise<BlogPost[]> => {
  const [authors, files] = await Promise.all([loadAuthors(), readdir(CONTENT)]);
  const posts = await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map(async (file) => {
        const slug = file.replace(/\.md$/, "");
        return parsePost(slug, await readFile(path.join(CONTENT, file), "utf8"), authors);
      }),
  );
  return posts.sort(byRecency);
});

export async function loadPost(slug: string): Promise<BlogPost | undefined> {
  return (await loadPosts()).find((post) => post.slug === slug);
}

/** The post that leads the front page: the newest featured one, or the newest. */
export function leadPost(posts: BlogPost[]): BlogPost | undefined {
  return posts.find((post) => post.featured) ?? posts[0];
}

/** Every tag in use, by how many posts carry it, then by name. */
export function tagsOf(posts: BlogPost[]): (BlogTag & { count: number })[] {
  const counts = new Map<string, BlogTag & { count: number }>();
  for (const tag of posts.flatMap((post) => post.tags)) {
    const seen = counts.get(tag.slug);
    counts.set(tag.slug, { ...tag, count: (seen?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Up to `limit` other posts to read next: those sharing the most tags first, then the newest. */
export function relatedPosts(post: BlogPost, posts: BlogPost[], limit = 3): BlogPost[] {
  const mine = new Set(post.tags.map((tag) => tag.slug));
  const shared = (other: BlogPost) => other.tags.filter((tag) => mine.has(tag.slug)).length;
  return posts
    .filter((other) => other.slug !== post.slug)
    .map((other, index) => ({ other, index, score: shared(other) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ other }) => other);
}
