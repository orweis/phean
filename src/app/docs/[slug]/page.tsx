import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocArticle } from "@/components/doc-article";
import { DOC_SLUGS, isDocSlug, loadDoc, loadDocIndex } from "@/server/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_SLUGS.filter((slug) => slug !== "index").map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  if (!isDocSlug(slug) || slug === "index") return {};
  const page = await loadDoc(slug);
  return { title: `${page.title} · Docs`, description: page.description };
}

/** One page of the docs site, with the pages before and after it in reading order. */
export default async function DocsPage({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  // The front page lives at /docs, so /docs/index is not a page of its own.
  if (!isDocSlug(slug) || slug === "index") notFound();
  const [page, pages] = await Promise.all([loadDoc(slug), loadDocIndex()]);
  const at = DOC_SLUGS.indexOf(slug);
  return <DocArticle page={page} previous={pages[at - 1]} next={pages[at + 1]} />;
}
