import { Brain, CalendarClock, ListTodo, Search, Target, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { cx } from "@/lib/cx";
import { GOAL_STATUS_META, isLate, isOneOf, MEMORY_KIND_META, TASK_STATUSES, TASK_STATUS_META, type TaskStatus, type Tone } from "@/lib/domain";
import { formatDueDate, pluralize } from "@/lib/format";
import { highlight, searchTerms } from "@/lib/highlight";
import { queryParam, routes } from "@/lib/routes";
import { attempt } from "@/server/actions";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals } from "@/server/domain/goals";
import { SEARCH_KINDS, type SearchKind } from "@/server/domain/schemas";
import { search, type SearchHit } from "@/server/domain/search";

export const metadata: Metadata = { title: "Search" };

interface KindView {
  label: string;
  icon: LucideIcon;
  meta: Record<string, { label: string; tone: Tone }>;
  href: (slug: string, hit: SearchHit) => string;
}

const KIND_VIEWS: Record<SearchKind, KindView> = {
  goal: { label: "Goals", icon: Target, meta: GOAL_STATUS_META, href: (slug, hit) => routes.goal(slug, hit.id) },
  task: {
    label: "Tasks",
    icon: ListTodo,
    meta: TASK_STATUS_META,
    href: (slug, hit) => (hit.goalId ? routes.goal(slug, hit.goalId) : routes.board(slug)),
  },
  memory: {
    label: "Memories",
    icon: Brain,
    meta: MEMORY_KIND_META,
    href: (slug, hit) => (hit.goalId ? routes.goal(slug, hit.goalId) : routes.memory(slug)),
  },
};

/** Open work first: what is moving, then what is waiting, then what is finished; relevance decides within each. */
const STATION_ORDER: readonly TaskStatus[] = ["in_progress", "todo", "inbox", "done", "dropped"];

function byStation(hits: readonly SearchHit[]): SearchHit[] {
  const order = (hit: SearchHit) => (isOneOf(TASK_STATUSES, hit.status) ? STATION_ORDER.indexOf(hit.status) : STATION_ORDER.length);
  return hits.map((hit, index) => ({ hit, index })).sort((a, b) => order(a.hit) - order(b.hit) || a.index - b.index).map(({ hit }) => hit);
}

/** The query's words marked in a result, in a token colour rather than the browser's yellow. */
function Marked({ text, terms }: { text: string; terms: readonly string[] }) {
  return highlight(text, terms).map((piece, index) =>
    piece.match ? (
      <mark key={index} className="rounded-xs bg-accent-tint px-0.5 text-ink">
        {piece.text}
      </mark>
    ) : (
      <span key={index}>{piece.text}</span>
    ),
  );
}

export default async function SearchPage({ params, searchParams }: PageProps<"/w/[slug]/search">) {
  const { slug } = await params;
  const q = queryParam((await searchParams).q);
  const { ctx } = await requireWorkspace(slug);
  const [result, goals] = await Promise.all([q ? attempt(() => search(ctx, { query: q, limit: 50 })) : null, listGoals(ctx, {})]);
  const goalTitles = new Map(goals.map((goal) => [goal.id, goal.title]));
  const terms = q ? searchTerms(q) : [];
  const missing = result?.ok ? SEARCH_KINDS.filter((kind) => !result.value.some((hit) => hit.kind === kind)) : [];

  return (
    <>
      <PageHeader title="Search" description="Full-text search across goals, tasks, and memory, ranked by relevance." />
      <div className="mb-6">
        <SearchForm action={routes.search(slug)} defaultValue={q} placeholder="Search goals, tasks, and memory…" autoFocus={!q} suggestFor={slug} />
      </div>

      {result && !result.ok && <p className="text-sm text-late-ink">{result.state.message}</p>}
      {result?.ok && result.value.length === 0 && (
        <EmptyState icon={<Search />} title={`Nothing matches "${q}"`}>
          Search matches whole words and word prefixes. Try fewer or shorter words.
        </EmptyState>
      )}
      {result?.ok && result.value.length > 0 && (
        <div className="space-y-6">
          {missing.length > 0 && (
            <p className="text-sm text-muted">
              No {new Intl.ListFormat("en", { type: "disjunction" }).format(missing.map((kind) => KIND_VIEWS[kind].label.toLowerCase()))} match “{q}”.
            </p>
          )}
          {SEARCH_KINDS.map((kind) => {
            const matching = result.value.filter((hit) => hit.kind === kind);
            const hits = kind === "task" ? byStation(matching) : matching;
            if (hits.length === 0) return null;
            const { label, icon: Icon, meta, href } = KIND_VIEWS[kind];
            return (
              <Card key={kind}>
                <CardHeader title={label} description={pluralize(hits.length, "result")} />
                <ul className="divide-y divide-rule">
                  {hits.map((hit) => {
                    const status = meta[hit.status];
                    const goalTitle = hit.goalId ? goalTitles.get(hit.goalId) : undefined;
                    const late = kind === "task" && isOneOf(TASK_STATUSES, hit.status) && isLate({ status: hit.status, dueDate: hit.dueDate });
                    return (
                      <li key={hit.id} data-hit={hit.kind}>
                        <Link href={href(slug, hit)} className="flex gap-3 px-5 py-3 transition-colors duration-(--dur-micro) hover:bg-fill">
                          <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink">
                              <Marked text={hit.title} terms={terms} />
                            </p>
                            {hit.snippet && hit.snippet !== hit.title && (
                              <p className="mt-0.5 line-clamp-2 text-xs text-ink-2">
                                <Marked text={hit.snippet} terms={terms} />
                              </p>
                            )}
                            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                              {status && <Badge tone={status.tone}>{status.label}</Badge>}
                              {goalTitle && kind !== "goal" && (
                                <span className="inline-flex min-w-0 items-center gap-1">
                                  <Target className="size-3 shrink-0" aria-hidden />
                                  <span className="max-w-56 truncate" title={goalTitle}>
                                    {goalTitle}
                                  </span>
                                </span>
                              )}
                              {goalTitle && kind === "goal" && <span className="max-w-56 truncate">Part of {goalTitle}</span>}
                              {hit.dueDate && (
                                <span className={cx("inline-flex items-center gap-1", late && "font-semibold text-late-ink")}>
                                  <CalendarClock className="size-3" aria-hidden />
                                  {late ? `Late, due ${formatDueDate(hit.dueDate)}` : `Due ${formatDueDate(hit.dueDate)}`}
                                </span>
                              )}
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
