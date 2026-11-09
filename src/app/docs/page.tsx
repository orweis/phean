import type { Metadata } from "next";

import { DocArticle } from "@/components/doc-article";
import { DOC_SLUGS, loadDoc, loadDocIndex } from "@/server/docs";

export async function generateMetadata(): Promise<Metadata> {
  const page = await loadDoc("index");
  return { title: page.title, description: page.description };
}

/** The docs site's front page. */
export default async function DocsHome() {
  const [page, pages] = await Promise.all([loadDoc("index"), loadDocIndex()]);
  const next = pages.find((candidate) => candidate.slug === DOC_SLUGS[1]);
  return <DocArticle page={page} previous={undefined} next={next} />;
}
