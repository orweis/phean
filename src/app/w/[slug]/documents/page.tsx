import { FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { createDocumentAction } from "@/app/w/[slug]/actions";
import { GoalField } from "@/components/goal-options";
import { PageHeader } from "@/components/page-header";
import { SearchForm } from "@/components/search-form";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { enumOptions, Field, Input, Select } from "@/components/ui/field";
import { Popover, PopoverCancel } from "@/components/ui/popover";
import { EmptyState } from "@/components/ui/stat";
import { SubmitButton } from "@/components/ui/submit-button";
import { DOCUMENT_FORMAT_META, formatBytes } from "@/lib/documents";
import { LIMITS } from "@/lib/domain";
import { pluralize, timeAgo } from "@/lib/format";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listDocuments } from "@/server/domain/documents";
import { listGoals } from "@/server/domain/goals";
import { can } from "@/server/domain/policy";

export const metadata: Metadata = { title: "Documents" };

/** Formats a person starts from in Phean; agents attach the rest. */
const WRITABLE = ["markdown", "mermaid", "text"] as const;

function NewDocument({ slug, goals }: { slug: string; goals: Awaited<ReturnType<typeof listGoals>> }) {
  return (
    <Popover variant="ghost" icon={<Plus aria-hidden />} label="New document" title="New document">
      <ActionForm action={createDocumentAction} workspace={slug} className="space-y-3">
        <input type="hidden" name="content" value="" />
        <Field label="Title" htmlFor="new-document-title">
          <Input id="new-document-title" name="title" required maxLength={LIMITS.documentTitle} placeholder="Notes for the Q4 close" />
        </Field>
        <Field label="Format" htmlFor="new-document-format">
          <Select id="new-document-format" name="format" defaultValue="markdown">
            {enumOptions(WRITABLE, DOCUMENT_FORMAT_META)}
          </Select>
        </Field>
        <GoalField id="new-document-goal" name="goalId" label="About goal" none="Whole workspace" goals={goals.filter((goal) => goal.status !== "abandoned")} />
        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="primary">
            Create and edit
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}

export default async function DocumentsPage({ params, searchParams }: PageProps<"/w/[slug]/documents">) {
  const { slug } = await params;
  const q = queryParam((await searchParams).q);
  const { ctx } = await requireWorkspace(slug);
  const [documents, goals] = await Promise.all([listDocuments(ctx, { query: q, limit: 100 }), listGoals(ctx, {})]);

  return (
    <>
      <PageHeader
        title="Documents"
        description="Drafts, handoff notes, reports and diagrams that agents and people attach to tasks and goals. Agents read them for context before picking up work."
        actions={can(ctx.actor, "document:write") && <NewDocument slug={slug} goals={goals} />}
      />
      <Card>
        <CardHeader title={q ? pluralize(documents.length, "match", "matches") : "All documents"} description="Most recently changed first." />
        <CardBody className="border-b border-rule">
          <SearchForm action={routes.documents(slug)} defaultValue={q} placeholder="Search titles and summaries…" label="Search documents" />
        </CardBody>
        {documents.length === 0 ? (
          <EmptyState icon={<FileText />} title={q ? "No documents match" : "No documents yet"}>
            Agents attach drafts and handoff notes to tasks with attach_document. You can start one here too.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-rule">
            {documents.map((document) => {
              const meta = DOCUMENT_FORMAT_META[document.format];
              const where = document.taskTitle ?? document.goalTitle;
              return (
                <li key={document.id} data-document={document.id}>
                  <Link href={routes.document(slug, document.id)} className="flex gap-3 px-5 py-3 transition-colors duration-(--dur-micro) hover:bg-fill">
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                        {document.title}
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </p>
                      {document.summary && <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">{document.summary}</p>}
                      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                        {where && <span className="max-w-64 truncate">{document.taskId ? "Task" : "Goal"}: {where}</span>}
                        <span>
                          {document.createdByName}, {timeAgo(document.updatedAt)}
                        </span>
                        <span>
                          v{document.version} · {formatBytes(document.size)}
                        </span>
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
