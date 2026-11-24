import type { Metadata } from "next";

import { DocArticle } from "@/components/doc-article";
import { DocsAnalytics } from "@/components/docs-analytics";
import { JsonLd } from "@/components/site/json-ld";
import { routes } from "@/lib/routes";
import { docSchema } from "@/server/site-schema";
import { DOC_SLUGS, docSectionOf, loadDoc, loadDocIndex } from "@/server/docs";

export async function generateMetadata(): Promise<Metadata> {
  const page = await loadDoc("index");
  return { title: page.title, description: page.description, alternates: { canonical: routes.docs() } };
}

/** The docs site's front page. */
export default async function DocsHome() {
  const [page, pages] = await Promise.all([loadDoc("index"), loadDocIndex()]);
  const next = pages.find((candidate) => candidate.slug === DOC_SLUGS[1]);
  return (
    <>
      <JsonLd data={docSchema(page.title, page.description, routes.docs(), [])} />
      <DocsAnalytics slug="index" section={docSectionOf("index")} />
      <DocArticle page={page} previous={undefined} next={next} />
    </>
  );
}
