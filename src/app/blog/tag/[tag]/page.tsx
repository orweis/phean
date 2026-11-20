import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PostGrid, SectionLabel, TagList } from "@/components/blog/blog-parts";
import { routes } from "@/lib/routes";
import { loadPosts, tagsOf } from "@/server/blog";

export const dynamicParams = false;

export async function generateStaticParams() {
  return tagsOf(await loadPosts()).map((tag) => ({ tag: tag.slug }));
}

async function findTag(slug: string) {
  const posts = await loadPosts();
  const tags = tagsOf(posts);
  const tag = tags.find((candidate) => candidate.slug === slug);
  return tag && { tag, tags, posts: posts.filter((post) => post.tags.some((each) => each.slug === slug)) };
}

export async function generateMetadata({ params }: PageProps<"/blog/tag/[tag]">): Promise<Metadata> {
  const found = await findTag((await params).tag);
  if (!found) return {};
  return { title: `${found.tag.name} · Blog`, description: `Stories on the Phean blog tagged ${found.tag.name}.`, alternates: { canonical: routes.blogTag(found.tag.slug) } };
}

/** The stories that carry one tag, newest first, with every tag to move between them. */
export default async function BlogTagPage({ params }: PageProps<"/blog/tag/[tag]">) {
  const found = await findTag((await params).tag);
  if (!found) notFound();
  const { tag, tags, posts } = found;
  return (
    <main className="mx-auto max-w-7xl px-4 pt-10 pb-24 sm:px-6 lg:pt-16">
      <header className="max-w-3xl">
        <p className="text-sm text-muted">
          <Link href={routes.blog()} className="link hover:text-ink">
            Blog
          </Link>{" "}
          / Tag
        </p>
        <h1 className="display mt-3 text-[clamp(2.25rem,4.4vw,3.5rem)] text-ink">{tag.name}</h1>
        <p className="mt-3 text-lg text-ink-2">
          {posts.length} {posts.length === 1 ? "story" : "stories"}
        </p>
      </header>
      <div className="mt-8">
        <TagList tags={tags} current={tag.slug} label="All tags" />
      </div>
      <section aria-labelledby="tag-stories" className="mt-14">
        <SectionLabel id="tag-stories">{`Stories tagged ${tag.name}`}</SectionLabel>
        <PostGrid posts={posts} />
      </section>
    </main>
  );
}
