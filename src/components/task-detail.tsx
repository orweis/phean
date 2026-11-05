import { Bot, CornerDownRight, History } from "lucide-react";
import Link from "next/link";

import { PRIORITY_META } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals } from "@/server/domain/goals";
import { can } from "@/server/domain/policy";
import { getTask } from "@/server/domain/tasks";
import { orNotFound } from "@/server/web";

import { ActivityFeed } from "./activity-feed";
import { ResumeLink, TaskLinks } from "./agent-sessions";
import { AnsweredDecisions } from "./answered-decisions";
import { MarkdownView } from "./documents/markdown-view";
import { DocumentChips } from "./documents/document-chips";
import { OpenQuestions } from "./open-questions";
import { StageBadge, TaskActionRow, TaskMeta } from "./task-card";
import { MetaBadge } from "./ui/badge";

function Section({ title, children, count }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-rule pt-4">
      <h3 className="mb-2 text-xs font-semibold text-ink-2">
        {title}
        {count !== undefined && <span className="figure ml-1.5 font-normal text-muted">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

/**
 * Everything on one task: where it stands and what to do next, its question if an agent asked
 * one, its description, links and documents, its subtasks, the sessions to resume, what was
 * decided on it, and its history. The same view fills the board's peek and the task's own page.
 */
export async function TaskDetail({ slug, taskId, headingLevel = 1 }: { slug: string; taskId: string; headingLevel?: 1 | 2 }) {
  const { ctx } = await requireWorkspace(slug);
  const [{ task, parent, subtasks, activity }, goals] = await Promise.all([orNotFound(getTask(ctx, { taskId })), listGoals(ctx, {})]);
  const canWrite = can(ctx.actor, "task:write");
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const answered = task.inputAnswers.map((request) => ({ task, request }));

  return (
    <article data-task-detail={task.id} className="space-y-5">
      <header className="space-y-2">
        {parent && (
          <p className="flex items-center gap-1 text-xs text-muted">
            <CornerDownRight className="size-3" aria-hidden />
            Subtask of{" "}
            <Link href={routes.task(slug, parent.id)} scroll={false} className="font-semibold text-ink-2 link">
              {parent.title}
            </Link>
          </p>
        )}
        <Heading id="task-title" className="text-xl font-bold text-ink">
          {task.title}
        </Heading>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StageBadge task={task} slug={slug} />
          {task.priority !== "medium" && <MetaBadge meta={PRIORITY_META} value={task.priority} />}
          <TaskMeta task={task} slug={slug} showGoal />
        </div>
        <p className="text-xs text-muted">
          Captured by {task.createdByName} {timeAgo(task.createdAt)} · updated {timeAgo(task.updatedAt)}
        </p>
        <TaskActionRow task={task} slug={slug} canWrite={canWrite} goals={goals} className="pt-1" />
      </header>

      {task.inputRequest && (
        <section aria-label="Waiting on you" className="rounded-lg border border-wait/70 bg-wait-tint/40 px-4">
          <OpenQuestions tasks={[task]} slug={slug} canAnswer={canWrite} />
        </section>
      )}

      {task.description && (
        <Section title="Notes">
          <MarkdownView source={task.description} />
        </Section>
      )}

      {(task.links.length > 0 || task.documents.length > 0) && (
        <Section title="Links and documents">
          <TaskLinks links={task.links} />
          <DocumentChips documents={task.documents} slug={slug} max={20} className={task.links.length ? "mt-2" : undefined} />
        </Section>
      )}

      {subtasks.length > 0 && (
        <Section title="Subtasks" count={subtasks.length}>
          <ul className="space-y-1.5">
            {subtasks.map((subtask) => (
              <li key={subtask.id} className="flex items-center justify-between gap-3 text-sm">
                <Link href={routes.task(slug, subtask.id)} scroll={false} className={subtask.status === "done" ? "text-muted line-through link" : "text-ink link"}>
                  {subtask.title}
                </Link>
                <StageBadge task={subtask} slug={slug} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {task.agentSessions.length > 0 && (
        <Section title="Where agents left off">
          <ul className="space-y-3">
            {task.agentSessions.map((session) => (
              <li key={session.agentId} className="space-y-1.5">
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <Bot className="size-3" aria-hidden />
                  <span className="font-semibold text-ink">{session.agentName}</span>
                  {session.app && <span>in {session.app}</span>}
                  <span>
                    <History className="mr-0.5 inline size-3" aria-hidden />
                    {timeAgo(session.linkedAt)}
                  </span>
                </p>
                {session.brief && <p className="text-sm text-ink-2">{session.brief}</p>}
                <ResumeLink session={session} variant="tinted" />
                {!session.url && (session.sessionId || session.command) && (
                  <code className="block truncate rounded-sm bg-fill px-1.5 py-1 font-mono text-xs text-ink" title={session.command ?? session.sessionId ?? ""}>
                    {session.command ?? session.sessionId}
                  </code>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {answered.length > 0 && (
        <Section title="Decided on this task" count={answered.length}>
          <AnsweredDecisions records={answered} slug={slug} />
        </Section>
      )}

      <Section title="Activity">
        <ActivityFeed events={activity} slug={slug} shown={6} />
      </Section>
    </article>
  );
}
