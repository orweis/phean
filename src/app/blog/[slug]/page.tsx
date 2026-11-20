import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthorCard, PostCard, PostCover, PostMeta, TagList } from "@/components/blog/blog-parts";
import { ShareLinks } from "@/components/blog/share-links";
import { MarkdownView } from "@/components/documents/markdown-view";
import { Art, artEntry } from "@/components/marketing/art";
import { ButtonLink } from "@/components/ui/button";
import { routes } from "@/lib/routes";
import { appUrl } from "@/server/config";
import { loadPost, loadPosts, relatedPosts } from "@/server/blog";

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await loadPosts()).map((post) => ({ slug: post.slug }));
}

/** The image link previews get: the cover's 1200x630 JPEG, or its largest WebP. */
function coverImage(cover: Parameters<typeof artEntry>[0]) {
  const { files, alt } = artEntry(cover);
  const image = files.find((file) => file.format === "jpeg") ?? files.filter((file) => file.format === "webp").at(-1) ?? files.at(-1)!;
  return { url: image.path, width: image.width, height: image.height, alt };
}

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const post = await loadPost((await params).slug);
  if (!post) return {};
  const image = coverImage(post.cover);
  return {
    metadataBase: new URL(appUrl()),
    title: `${post.title} · Blog`,
    description: post.description,
    authors: [{ name: post.author.name, url: routes.blogAuthor(post.author.slug) }],
    keywords: post.tags.map((tag) => tag.name),
    alternates: { canonical: routes.blog(post.slug), types: { "application/rss+xml": routes.blogFeed() } },
    openGraph: {
      type: "article",
      siteName: "Phean",
      title: post.title,
      description: post.description,
      url: routes.blog(post.slug),
      publishedTime: post.date,
      authors: [post.author.name],
      tags: post.tags.map((tag) => tag.name),
      images: [image],
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description, images: [image] },
  };
}

/** The post as structured data, for search engines: the article and where it sits on the site. */
function StructuredData({ post, url }: { post: NonNullable<Awaited<ReturnType<typeof loadPost>>>; url: string }) {
  const base = appUrl();
  const graph = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      headline: post.title,
      description: post.description,
      image: [`${base}${coverImage(post.cover).url}`],
      datePublished: post.date,
      author: { "@type": "Person", name: post.author.name, url: `${base}${routes.blogAuthor(post.author.slug)}` },
      publisher: { "@type": "Organization", name: "Phean", logo: { "@type": "ImageObject", url: `${base}/icon.svg` } },
      keywords: post.tags.map((tag) => tag.name).join(", "),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Phean", item: `${base}/` },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${base}${routes.blog()}` },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ];
  // JSON in a script tag: escape "<" so a title can never close the tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, "\\u003c") }} />;
}

/**
 * One post, laid out after the Permit.io blog: breadcrumbs, the title and summary, the cover, the byline
 * with share links; then the story in a reading column with its outline and tags beside it, the writer,
 * stories to read next, and a closing call to action.
 */
export default async function BlogPostPage({ params }: PageProps<"/blog/[slug]">) {
  const { slug } = await params;
  const [post, posts] = await Promise.all([loadPost(slug), loadPosts()]);
  if (!post) notFound();
  const url = `${appUrl()}${routes.blog(post.slug)}`;
  const next = relatedPosts(post, posts);

  return (
    <main>
      <StructuredData post={post} url={url} />
      <article>
        <header className="mx-auto max-w-5xl px-4 pt-8 sm:px-6 lg:pt-12">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
              <li>
                <Link href={routes.home()} className="hover:text-ink">
                  Home
                </Link>
              </li>
              <li aria-hidden>
                <ChevronRight className="size-3.5" />
              </li>
              <li>
                <Link href={routes.blog()} className="hover:text-ink">
                  Blog
                </Link>
              </li>
              <li aria-hidden>
                <ChevronRight className="size-3.5" />
              </li>
              <li aria-current="page" className="min-w-0 truncate text-ink-2">
                {post.title}
              </li>
            </ol>
          </nav>
          <h1 className="display mt-6 max-w-4xl text-[clamp(2.125rem,4.4vw,3.5rem)] text-ink">{post.title}</h1>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-ink-2">{post.description}</p>
          <PostCover post={post} sizes="(min-width: 1024px) 64rem, 100vw" className="mt-8" />
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-b border-rule pb-6">
            <PostMeta post={post} />
            <ShareLinks url={url} title={post.title} />
          </div>
        </header>

        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-12">
          <div className="min-w-0 py-8">
            {post.outline.length > 1 && (
              <details className="group mb-8 rounded-lg border border-rule bg-panel lg:hidden">
                <summary className="flex h-11 items-center justify-between px-4 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
                  In this story
                  <ChevronRight aria-hidden className="size-4 text-muted transition-transform group-open:rotate-90" />
                </summary>
                <ul className="space-y-1 border-t border-rule px-4 py-3 text-sm">
                  {post.outline.map(({ id, title }) => (
                    <li key={id}>
                      <a href={`#${id}`} className="block py-1 text-ink-2 hover:text-ink">
                        {title}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="docs-body max-w-[72ch]">
              <MarkdownView source={post.body} headings="anchored" />
            </div>

            <section aria-labelledby="written-by" className="mt-14 border-t border-rule pt-8">
              <h2 id="written-by" className="mb-5 text-xs font-semibold tracking-[0.18em] text-muted uppercase">
                Written by
              </h2>
              <AuthorCard author={post.author} />
            </section>
          </div>

          <aside className="hidden lg:block">
            <div className="sticky top-20 space-y-8 py-8">
              {post.outline.length > 1 && (
                <nav aria-label="In this story">
                  <h2 className="text-xs font-semibold text-muted">In this story</h2>
                  <ul className="mt-2 space-y-1.5 border-l border-rule">
                    {post.outline.map(({ id, title }) => (
                      <li key={id}>
                        <a href={`#${id}`} className="-ml-px block border-l border-transparent pl-3 text-sm text-ink-2 hover:border-edge hover:text-ink">
                          {title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
              {post.tags.length > 0 && (
                <div>
                  <h2 className="mb-2 text-xs font-semibold text-muted">Tags</h2>
                  <TagList tags={post.tags} label="This story's tags" />
                </div>
              )}
            </div>
          </aside>
        </div>
      </article>

      {next.length > 0 && (
        <section aria-labelledby="read-next" className="mx-auto max-w-5xl px-4 pt-8 pb-20 sm:px-6">
          <h2 id="read-next" className="mb-8 border-b border-rule pb-3 text-xs font-semibold tracking-[0.18em] text-muted uppercase">
            Read next
          </h2>
          <ul className="grid gap-x-8 gap-y-12 md:grid-cols-3">
            {next.map((other) => (
              <li key={other.slug}>
                <PostCard post={other} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="blog-cta" data-dusk className="dusk relative isolate overflow-hidden">
        <Art id="cta-band" decorative sizes="100vw" className="absolute inset-0 -z-10 size-full object-cover object-[72%_50%]" />
        <div aria-hidden className="cta-scrim absolute inset-0 -z-10" />
        <div className="mx-auto max-w-7xl px-4 py-24 text-center sm:px-6 sm:py-32">
          <h2 id="blog-cta" className="display mx-auto max-w-3xl text-[clamp(2rem,4.4vw,3.5rem)] text-dusk-ink">
            Your agents are already doing the work. Give them one place to ask.
          </h2>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href={routes.signUp()} variant="signal" size="lg">
              Create a workspace
            </ButtonLink>
            <ButtonLink href={routes.docs()} variant="dusk" size="lg" className="ring-1 ring-dusk-muted/40 ring-inset">
              Read the docs
            </ButtonLink>
          </div>
        </div>
      </section>
    </main>
  );
}
