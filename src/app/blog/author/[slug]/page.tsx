import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthorCard, PostGrid, SectionLabel } from "@/components/blog/blog-parts";
import { routes } from "@/lib/routes";
import { loadAuthors, loadPosts } from "@/server/blog";

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await loadAuthors()).map((author) => ({ slug: author.slug }));
}

export async function generateMetadata({ params }: PageProps<"/blog/author/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const author = (await loadAuthors()).find((candidate) => candidate.slug === slug);
  if (!author) return {};
  return { title: `${author.name} · Blog`, description: author.bio, alternates: { canonical: routes.blogAuthor(author.slug) } };
}

/** One writer: who they are, and everything they wrote, newest first. */
export default async function BlogAuthorPage({ params }: PageProps<"/blog/author/[slug]">) {
  const { slug } = await params;
  const [authors, posts] = await Promise.all([loadAuthors(), loadPosts()]);
  const author = authors.find((candidate) => candidate.slug === slug);
  if (!author) notFound();
  const theirs = posts.filter((post) => post.author.slug === author.slug);
  return (
    <main className="mx-auto max-w-7xl px-4 pt-10 pb-24 sm:px-6 lg:pt-16">
      <p className="text-sm text-muted">
        <Link href={routes.blog()} className="link hover:text-ink">
          Blog
        </Link>{" "}
        / Writer
      </p>
      <h1 className="display mt-3 text-[clamp(2.25rem,4.4vw,3.5rem)] text-ink">{author.name}</h1>
      <div className="mt-6">
        <AuthorCard author={author} linkToPage={false} />
      </div>
      <section aria-labelledby="author-stories" className="mt-14">
        <SectionLabel id="author-stories">{`Stories by ${author.name}`}</SectionLabel>
        <PostGrid posts={theirs} />
      </section>
    </main>
  );
}
