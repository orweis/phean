import type { MetadataRoute } from "next";

import { routes } from "@/lib/routes";
import { loadAuthors, loadPosts, tagsOf } from "@/server/blog";
import { appUrl } from "@/server/config";
import { DOC_SLUGS } from "@/server/docs";

// Read per request, so the addresses are the deployment's own rather than the build machine's.
export const dynamic = "force-dynamic";

/** Every public page: the landing page, each docs page, the blog with its posts, tags and writers, and the privacy policy. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl();
  const [posts, authors] = await Promise.all([loadPosts(), loadAuthors()]);
  const newest = posts[0]?.date;
  const at = (path: string) => `${base}${path}`;
  return [
    { url: at(routes.home()), changeFrequency: "weekly", priority: 1 },
    ...DOC_SLUGS.map((slug) => ({ url: at(slug === "index" ? routes.docs() : routes.docs(slug)), changeFrequency: "weekly" as const, priority: slug === "index" ? 0.9 : 0.7 })),
    { url: at(routes.blog()), lastModified: newest, changeFrequency: "weekly", priority: 0.8 },
    ...posts.map((post) => ({ url: at(routes.blog(post.slug)), lastModified: post.date, changeFrequency: "monthly" as const, priority: 0.7 })),
    ...tagsOf(posts).map((tag) => ({ url: at(routes.blogTag(tag.slug)), changeFrequency: "weekly" as const, priority: 0.4 })),
    ...authors.map((author) => ({ url: at(routes.blogAuthor(author.slug)), changeFrequency: "monthly" as const, priority: 0.4 })),
    { url: at(routes.privacy()), changeFrequency: "yearly", priority: 0.2 },
  ];
}
