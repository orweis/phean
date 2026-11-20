import type { Metadata } from "next";

import { FeaturedPost, Pager, PostGrid, SectionLabel, TagList } from "@/components/blog/blog-parts";
import { artEntry } from "@/components/marketing/art";
import { JsonLd } from "@/components/site/json-ld";
import { routes } from "@/lib/routes";
import { appUrl } from "@/server/config";
import { BLOG_PAGE_SIZE, leadPost, loadPosts, tagsOf } from "@/server/blog";
import { breadcrumbSchema } from "@/server/site-schema";

const TITLE = "The Phean blog";
const DESCRIPTION = "Notes on running AI agents and personal assistants: task management flipped, agent fleets, and the calls that stay with people.";
const OG = artEntry("og-card");

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: { absolute: `${TITLE}: agents, assistants and the calls that stay yours` },
  description: DESCRIPTION,
  alternates: { canonical: routes.blog(), types: { "application/rss+xml": routes.blogFeed() } },
  openGraph: {
    type: "website",
    siteName: "Phean",
    title: TITLE,
    description: DESCRIPTION,
    url: routes.blog(),
    images: [{ url: OG.files.find((file) => file.format === "jpeg")!.path, width: 1200, height: 630, alt: OG.alt }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/** The blog's front page: the lead story, then every other story newest first, a page at a time, then the tags. */
export default async function BlogHome({ searchParams }: PageProps<"/blog">) {
  const { page: pageParam } = await searchParams;
  const posts = await loadPosts();
  const lead = leadPost(posts);
  const rest = posts.filter((post) => post !== lead);
  const pages = Math.max(1, Math.ceil(rest.length / BLOG_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(typeof pageParam === "string" ? pageParam : "1", 10) || 1));
  const shown = rest.slice((page - 1) * BLOG_PAGE_SIZE, page * BLOG_PAGE_SIZE);
  const tags = tagsOf(posts);

  return (
    <main className="mx-auto max-w-7xl px-4 pt-10 pb-24 sm:px-6 lg:pt-16">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Blog",
            name: TITLE,
            description: DESCRIPTION,
            url: `${appUrl()}${routes.blog()}`,
            publisher: { "@id": `${appUrl()}/#organization` },
            blogPost: posts.map((post) => ({
              "@type": "BlogPosting",
              headline: post.title,
              url: `${appUrl()}${routes.blog(post.slug)}`,
              datePublished: post.date,
              author: { "@type": "Person", name: post.author.name },
            })),
          },
          breadcrumbSchema([{ name: "Blog", path: routes.blog() }]),
        ]}
      />
      <header className="max-w-3xl">
        <h1 className="display text-[clamp(2.5rem,5vw,4rem)] text-ink">The Phean blog</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-2">{DESCRIPTION}</p>
      </header>

      {lead && page === 1 && (
        <section aria-labelledby="featured-heading" className="mt-14">
          <SectionLabel id="featured-heading">Featured story</SectionLabel>
          <FeaturedPost post={lead} />
        </section>
      )}

      {shown.length > 0 && (
        <section aria-labelledby="all-stories" className="mt-20 scroll-mt-20">
          <SectionLabel id="all-stories">All stories</SectionLabel>
          <PostGrid posts={shown} />
          <Pager page={page} pages={pages} />
        </section>
      )}

      {tags.length > 0 && (
        <section aria-labelledby="tags-heading" className="mt-20">
          <SectionLabel id="tags-heading">Browse by tag</SectionLabel>
          <TagList tags={tags} />
        </section>
      )}
    </main>
  );
}
