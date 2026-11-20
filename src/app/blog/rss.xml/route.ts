import { routes } from "@/lib/routes";
import { appUrl } from "@/server/config";
import { loadPosts } from "@/server/blog";

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The blog as RSS 2.0: every post's title, summary, writer, tags and date, newest first. */
export async function GET() {
  const base = appUrl();
  const posts = await loadPosts();
  const items = posts.map((post) => {
    const link = `${base}${routes.blog(post.slug)}`;
    return [
      "    <item>",
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${link}</link>`,
      `      <guid isPermaLink="true">${link}</guid>`,
      `      <description>${escapeXml(post.description)}</description>`,
      `      <dc:creator>${escapeXml(post.author.name)}</dc:creator>`,
      ...post.tags.map((tag) => `      <category>${escapeXml(tag.name)}</category>`),
      `      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>`,
      "    </item>",
    ].join("\n");
  });
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    "    <title>The Phean blog</title>",
    `    <link>${base}${routes.blog()}</link>`,
    `    <atom:link href="${base}${routes.blogFeed()}" rel="self" type="application/rss+xml" />`,
    "    <description>Notes on running AI agents and personal assistants, from the people building Phean.</description>",
    "    <language>en</language>",
    ...items,
    "  </channel>",
    "</rss>",
  ].join("\n");
  return new Response(`${xml}\n`, { headers: { "content-type": "application/rss+xml; charset=utf-8" } });
}
