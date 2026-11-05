import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { DocumentDetail } from "@/components/documents/document-detail";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { getDocument } from "@/server/domain/documents";
import { orNotFound } from "@/server/web";

const loadDocument = cache(async (slug: string, id: string) => {
  const { ctx } = await requireWorkspace(slug);
  return orNotFound(getDocument(ctx, { documentId: id }));
});

export async function generateMetadata({ params }: PageProps<"/w/[slug]/documents/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  return { title: (await loadDocument(slug, id)).document.title };
}

/** A document as its own page: what a shared link or a refresh opens, and the peek's "Open as page". */
export default async function DocumentPage({ params, searchParams }: PageProps<"/w/[slug]/documents/[id]">) {
  const { slug, id } = await params;
  const editing = queryParam((await searchParams).mode) === "edit";
  const { document } = await loadDocument(slug, id);
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3">
        <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
          <li>
            <Link href={routes.documents(slug)} className="hover:text-ink link">
              Documents
            </Link>
          </li>
          <li aria-hidden>›</li>
          <li aria-current="page" className="max-w-64 truncate text-ink-2" title={document.title}>
            {document.title}
          </li>
        </ol>
      </nav>
      <DocumentDetail slug={slug} documentId={id} editing={editing} />
    </>
  );
}
