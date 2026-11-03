import { Brain, ListTodo, Search, Target, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { GOAL_STATUS_META, MEMORY_KIND_META, TASK_STATUS_META, type Tone } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { queryParam, routes } from "@/lib/routes";
import { attempt } from "@/server/actions";
import { requireWorkspace } from "@/server/auth/session";
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

export default async function SearchPage({ params, searchParams }: PageProps<"/w/[slug]/search">) {
  const { slug } = await params;
  const q = queryParam((await searchParams).q);
  const { ctx } = await requireWorkspace(slug);
  const result = q ? await attempt(() => search(ctx, { query: q, limit: 50 })) : null;

  return (
    <>
      <PageHeader title="Search" description="Full-text search across goals, tasks, and memory, ranked by relevance." />
      <div className="mb-6">
        <SearchForm action={routes.search(slug)} defaultValue={q} placeholder="Search goals, tasks, and memory…" autoFocus={!q} />
      </div>

      {result && !result.ok && <p className="text-sm text-late-ink">{result.state.message}</p>}
      {result?.ok && result.value.length === 0 && (
        <EmptyState icon={<Search />} title={`Nothing matches "${q}"`}>
          Search matches whole words and word prefixes. Try fewer or shorter words.
        </EmptyState>
      )}
      {result?.ok && result.value.length > 0 && (
        <div className="space-y-6">
          {SEARCH_KINDS.map((kind) => {
            const hits = result.value.filter((hit) => hit.kind === kind);
            if (hits.length === 0) return null;
            const { label, icon: Icon, meta, href } = KIND_VIEWS[kind];
            return (
              <Card key={kind}>
                <CardHeader title={label} description={pluralize(hits.length, "result")} />
                <ul className="divide-y divide-rule">
                  {hits.map((hit) => {
                    const status = meta[hit.status];
                    return (
                      <li key={hit.id}>
                        <Link href={href(slug, hit)} className="flex gap-3 px-5 py-3 transition-colors duration-(--dur-micro) hover:bg-fill">
                          <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{hit.title}</span>
                              {status && <Badge tone={status.tone}>{status.label}</Badge>}
                            </div>
                            {hit.snippet && hit.snippet !== hit.title && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{hit.snippet}</p>}
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
