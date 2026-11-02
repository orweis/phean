import type { Metadata } from "next";
import Link from "next/link";

import { MemoryList } from "@/components/memory-list";
import { PageHeader } from "@/components/page-header";
import { RememberForm } from "@/components/remember-form";
import { SearchForm } from "@/components/search-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cx } from "@/lib/cx";
import { MEMORY_KIND_META, MEMORY_KINDS, type MemoryKind } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals } from "@/server/domain/goals";
import { recall } from "@/server/domain/memory";
import { can } from "@/server/domain/policy";

export const metadata: Metadata = { title: "Memory" };

const MEMORY_PAGE_SIZE = 100;

function asMemoryKind(value: string | undefined): MemoryKind | undefined {
  return MEMORY_KINDS.find((kind) => kind === value);
}

export default async function MemoryPage({ params, searchParams }: PageProps<"/w/[slug]/memory">) {
  const { slug } = await params;
  const query = await searchParams;
  const q = queryParam(query.q);
  const kind = asMemoryKind(queryParam(query.kind));
  const { ctx } = await requireWorkspace(slug);
  const [memories, goals] = await Promise.all([recall(ctx, { query: q, kind, limit: MEMORY_PAGE_SIZE }), listGoals(ctx, {})]);
  const canWrite = can(ctx.actor, "memory:write");
  const filtered = Boolean(q || kind);

  return (
    <>
      <PageHeader
        title="Memory"
        description="Long-term knowledge shared by every agent in this workspace: facts, preferences, and decisions they recall before acting."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title={filtered ? pluralize(memories.length, "match", "matches") : "Everything remembered"}
            description={memories.length === MEMORY_PAGE_SIZE ? `Showing the ${MEMORY_PAGE_SIZE} most relevant.` : undefined}
          />
          <CardBody className="space-y-3 border-b border-rule">
            <SearchForm action={routes.memory(slug)} defaultValue={q} placeholder="Search memory…" keep={{ kind }} />
            <nav aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
              {[undefined, ...MEMORY_KINDS].map((option) => (
                <Link
                  key={option ?? "all"}
                  href={routes.memory(slug, { kind: option, q })}
                  aria-current={option === kind ? "page" : undefined}
                  className={cx(
                    "rounded-sm border px-2.5 py-1 text-xs font-semibold transition-colors duration-(--dur-micro)",
                    option === kind ? "border-shell bg-shell text-shell-ink" : "border-rule text-ink-2 hover:border-edge hover:text-ink",
                  )}
                >
                  {option ? MEMORY_KIND_META[option].label : "All"}
                </Link>
              ))}
            </nav>
          </CardBody>
          <CardBody className="py-1">
            <MemoryList
              memories={memories}
              slug={slug}
              canWrite={canWrite}
              goalTitles={new Map(goals.map((goal) => [goal.id, goal.title]))}
              empty={filtered ? "No memories match" : undefined}
            />
          </CardBody>
        </Card>
        {canWrite && (
          <Card className="h-fit">
            <CardHeader title="Remember something" description="Agents recall this before they act." />
            <CardBody>
              <RememberForm slug={slug} goals={goals.filter((goal) => goal.status !== "abandoned")} />
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
