import { DocumentDetail } from "@/components/documents/document-detail";
import { Peek } from "@/components/ui/peek";
import { queryParam, routes } from "@/lib/routes";

/** A document opened from a task, a decision or a list: a wide peek over the page, with room to read. */
export default async function DocumentPeek({ params, searchParams }: PageProps<"/w/[slug]/documents/[id]">) {
  const { slug, id } = await params;
  const editing = queryParam((await searchParams).mode) === "edit";
  return (
    <Peek label="Document" layout="center" pageHref={routes.document(slug, id, editing ? "edit" : undefined)}>
      <DocumentDetail slug={slug} documentId={id} editing={editing} headingLevel={2} />
    </Peek>
  );
}
