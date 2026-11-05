import { Download, Pencil, Target, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";

import { deleteDocumentAction } from "@/app/w/[slug]/actions";
import { DocumentBody } from "@/components/documents/document-body";
import { DocumentEditor } from "@/components/documents/document-editor";
import { ActionButton } from "@/components/ui/action-button";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DOCUMENT_FORMAT_META, formatBytes, isTextFormat } from "@/lib/documents";
import { timeAgo } from "@/lib/format";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { getDocument } from "@/server/domain/documents";
import { findGoal } from "@/server/domain/goals";
import { can } from "@/server/domain/policy";
import { findTask } from "@/server/domain/tasks";
import { orNotFound } from "@/server/web";

const loadDocument = cache(async (slug: string, id: string) => {
  const { ctx } = await requireWorkspace(slug);
  return orNotFound(getDocument(ctx, { documentId: id }));
});

export async function generateMetadata({ params }: PageProps<"/w/[slug]/documents/[id]">): Promise<Metadata> {
  const { slug, id } = await params;
  return { title: (await loadDocument(slug, id)).document.title };
}

export default async function DocumentPage({ params, searchParams }: PageProps<"/w/[slug]/documents/[id]">) {
  const { slug, id } = await params;
  const editing = queryParam((await searchParams).mode) === "edit";
  const { ctx } = await requireWorkspace(slug);
  const { document, content } = await loadDocument(slug, id);
  const [task, goal] = await Promise.all([
    document.taskId ? findTask(ctx, document.taskId) : null,
    document.goalId ? findGoal(ctx, document.goalId) : null,
  ]);
  const canWrite = can(ctx.actor, "document:write");
  const editable = canWrite && isTextFormat(document.format);
  const meta = DOCUMENT_FORMAT_META[document.format];

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

      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink">{document.title}</h1>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          {document.summary && <p className="mt-1.5 max-w-3xl text-sm text-ink-2">{document.summary}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>
              Version {document.version} · {document.version > 1 ? `edited by ${document.updatedByName}` : `by ${document.createdByName}`} {timeAgo(document.updatedAt)}
            </span>
            <span>{formatBytes(document.size)}</span>
            {task && (
              <span>
                On task{" "}
                <Link href={routes.board(slug)} className="font-semibold text-ink-2 link">
                  {task.title}
                </Link>
              </span>
            )}
            {goal && (
              <Link href={routes.goal(slug, goal.id)} className="inline-flex items-center gap-1 font-semibold text-ink-2 link">
                <Target className="size-3" aria-hidden />
                {goal.title}
              </Link>
            )}
          </p>
        </div>
        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
            {editable && (
              <ButtonLink href={routes.document(slug, document.id, "edit")} size="sm" variant="secondary">
                <Pencil aria-hidden />
                Edit
              </ButtonLink>
            )}
            <ButtonLink href={routes.documentFile(slug, document.id, true)} size="sm" variant="ghost" prefetch={false}>
              <Download aria-hidden />
              Download
            </ButtonLink>
            {canWrite && (
              <ActionButton
                action={deleteDocumentAction}
                workspace={slug}
                fields={{ documentId: document.id }}
                confirm={`Delete "${document.title}" for everyone, agents included?`}
                size="sm"
                variant="ghost"
              >
                <Trash2 aria-hidden />
                Delete
              </ActionButton>
            )}
          </div>
        )}
      </div>

      {editing && editable ? (
        <DocumentEditor slug={slug} document={document} content={content ?? ""} />
      ) : (
        <Card>
          <CardBody className="py-5">
            <DocumentBody slug={slug} document={document} content={content} />
          </CardBody>
        </Card>
      )}
    </>
  );
}
