import { Download, Pencil, Target, Trash2 } from "lucide-react";
import Link from "next/link";

import { deleteDocumentAction } from "@/app/w/[slug]/actions";
import { DOCUMENT_FORMAT_META, formatBytes, isTextFormat } from "@/lib/documents";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { getDocument } from "@/server/domain/documents";
import { findGoal } from "@/server/domain/goals";
import { can } from "@/server/domain/policy";
import { findTask } from "@/server/domain/tasks";
import { orNotFound } from "@/server/web";

import { ActionButton } from "../ui/action-button";
import { Badge } from "../ui/badge";
import { ButtonLink } from "../ui/button";
import { DocumentBody } from "./document-body";
import { DocumentEditor } from "./document-editor";

/**
 * One document: its title, what it is, who changed it last and where it is attached, then its
 * content as its format reads best, or the editor. The same view fills the peek and the page.
 */
export async function DocumentDetail({ slug, documentId, editing, headingLevel = 1 }: { slug: string; documentId: string; editing: boolean; headingLevel?: 1 | 2 }) {
  const { ctx } = await requireWorkspace(slug);
  const { document, content } = await orNotFound(getDocument(ctx, { documentId }));
  const [task, goal] = await Promise.all([
    document.taskId ? findTask(ctx, document.taskId) : null,
    document.goalId ? findGoal(ctx, document.goalId) : null,
  ]);
  const canWrite = can(ctx.actor, "document:write");
  const editable = canWrite && isTextFormat(document.format);
  const meta = DOCUMENT_FORMAT_META[document.format];
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <article data-document-detail={document.id}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <Heading id="document-title" className="text-2xl font-bold text-ink">
              {document.title}
            </Heading>
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
                <Link href={routes.task(slug, task.id)} scroll={false} className="font-semibold text-ink-2 link">
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
              <ButtonLink href={routes.document(slug, document.id, "edit")} scroll={false} size="sm" variant="secondary">
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
        <div className="rounded-lg border border-rule bg-panel px-5 py-5">
          <DocumentBody slug={slug} document={document} content={content} />
        </div>
      )}
    </article>
  );
}
