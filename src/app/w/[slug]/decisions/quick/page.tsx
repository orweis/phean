import type { Metadata } from "next";
import Link from "next/link";

import { DocumentBody } from "@/components/documents/document-body";
import { QuickDecisions, type QuickFile } from "@/components/quick-decisions/quick-decisions";
import { askedInApp, askerName, sessionOfAsker } from "@/lib/agent-sessions";
import { DOCUMENT_FORMAT_META } from "@/lib/documents";
import { timeAgo } from "@/lib/format";
import { runLabel } from "@/lib/pipelines";
import { CONTEXT_TABS, doneTitle, QUICK_ENTRIES, requestOwningFile, type ContextTab, type QuickEntry, type QuickItem } from "@/lib/quick-decisions";
import { isOneOf } from "@/lib/domain";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { getDocument } from "@/server/domain/documents";
import { can } from "@/server/domain/policy";
import { describePipelineRequests, type PipelineRequestContext } from "@/server/domain/pipelines";
import { listDecisions, type TaskView } from "@/server/domain/tasks";

export const metadata: Metadata = { title: "Quick Decisions" };

/** The done screen's title, a different one now and then: picked on the server, per visit. */
const randomDoneTitle = () => doneTitle(Math.random());

/** What the card says about a pipeline's decision: its run and stop, where it stands, and its time limit. */
function pipelineLine(task: TaskView, context: PipelineRequestContext | undefined): QuickItem["pipeline"] {
  const ref = task.inputRequest!.pipeline;
  if (!ref) return null;
  const limit = context?.dueAt
    ? context.onTimeout
      ? `Defaults to “${context.onTimeout}” ${timeAgo(context.dueAt)}`
      : `Time limit ${timeAgo(context.dueAt)}; then the stop fails`
    : null;
  return {
    label: `${runLabel({ name: context?.runName ?? ref.runName, number: ref.runNumber }, ref.pipelineName)} · ${ref.stopName}`,
    position: context?.position ? `Stop ${context.position.index} of ${context.position.total}` : null,
    timeLimit: limit,
    steps: context?.steps ?? [],
  };
}

/**
 * Quick Decisions: the open requests one card at a time, made for a phone. The queue, the request on
 * screen and its view (the card, its full context, one of its files) are all in the URL, so the
 * browser's Back steps through them; the answers go through the same actions as the Decisions page.
 */
export default async function QuickDecisionsPage({ params, searchParams }: PageProps<"/w/[slug]/decisions/quick">) {
  const { slug } = await params;
  const query = await searchParams;
  const { ctx, viewer } = await requireWorkspace(slug);
  const canAnswer = can(ctx.actor, "task:write");

  if (!canAnswer) {
    return (
      <div className="mx-auto w-full max-w-md py-10 text-center">
        <h1 className="text-2xl font-bold tracking-display text-ink">Quick Decisions</h1>
        <p className="mt-2 text-sm text-ink-2">You can read this workspace&apos;s decisions, but not answer them.</p>
        <Link href={routes.decisions(slug)} className="mt-4 inline-block text-sm font-semibold text-accent-ink link">
          Back to Decisions
        </Link>
      </div>
    );
  }

  const { open } = await listDecisions(ctx, {});
  const pinned = open.filter((task) => task.inputRequest?.pipeline);
  const contexts = pinned.length
    ? await describePipelineRequests(ctx, { requests: pinned.map((task) => ({ runId: task.inputRequest!.pipeline!.runId, stopId: task.inputRequest!.pipeline!.stopId })) })
    : {};
  // A pipeline's decision is only for its approvers; anyone else would only be refused, so it is left out of their queue.
  const contextOf = (task: TaskView) => (task.inputRequest?.pipeline ? contexts[`${task.inputRequest.pipeline.runId}:${task.inputRequest.pipeline.stopId}`] : undefined);
  const answerable = open.filter((task) => !task.inputRequest?.pipeline || contextOf(task)?.mayDecide);
  const items: QuickItem[] = answerable.map((task) => {
    const request = task.inputRequest!;
    const app = askedInApp(request, sessionOfAsker(task.agentSessions, request)?.app);
    return {
      taskId: task.id,
      title: task.title,
      request,
      asker: askerName(request),
      where: task.goalTitle ?? app,
      age: timeAgo(request.askedAt),
      documents: task.documents,
      pipeline: pipelineLine(task, contextOf(task)),
    };
  });

  const view = queryParam(query.view);
  const requestId = queryParam(query.request);
  const tab: ContextTab = isOneOf(CONTEXT_TABS, queryParam(query.tab)) ? (queryParam(query.tab) as ContextTab) : "context";
  const from = queryParam(query.from);
  const entry: QuickEntry = isOneOf(QUICK_ENTRIES, from) ? (from as QuickEntry) : "link";

  // A file of the request on screen, read here (with the workspace's access check) and drawn as the document page draws it.
  const fileId = view === "file" ? queryParam(query.file) : undefined;
  const owner = requestOwningFile(items, requestId, fileId);
  let file: QuickFile | null = null;
  if (owner && fileId) {
    const loaded = await getDocument(ctx, { documentId: fileId }).catch(() => null);
    if (loaded) {
      const { document, content } = loaded;
      file = {
        id: document.id,
        title: document.title,
        kind: DOCUMENT_FORMAT_META[document.format].label,
        downloadHref: routes.documentFile(slug, document.id, true),
        body: <DocumentBody slug={slug} document={document} content={content} />,
      };
    }
  }

  return (
    <QuickDecisions
      slug={slug}
      userId={viewer.user.id}
      items={items}
      view={file ? "file" : view === "context" ? "context" : "card"}
      requestId={requestId ?? null}
      tab={tab}
      file={file}
      entry={entry}
      doneTitle={randomDoneTitle()}
    />
  );
}
