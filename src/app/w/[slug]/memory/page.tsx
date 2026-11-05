import type { Metadata } from "next";
import Link from "next/link";

import { Plus } from "lucide-react";

import { MemoryList } from "@/components/memory-list";
import { PageHeader } from "@/components/page-header";
import { RememberForm } from "@/components/remember-form";
import { SearchForm } from "@/components/search-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { cx } from "@/lib/cx";
import { isOneOf, MEMORY_KIND_META, MEMORY_KINDS } from "@/lib/domain";
import { pluralize } from "@/lib/format";
import { queryParam, routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals } from "@/server/domain/goals";
import { countMemoryKinds, recall } from "@/server/domain/memory";
import { can } from "@/server/domain/policy";

export const metadata: Metadata = { title: "Memory" };

const MEMORY_PAGE_SIZE = 100;

export default async function MemoryPage({ params, searchParams }: PageProps<"/w/[slug]/memory">) {
  const { slug } = await params;
  const query = await searchParams;
  const q = queryParam(query.q);
  const kindParam = queryParam(query.kind);
  const kind = isOneOf(MEMORY_KINDS, kindParam) ? kindParam : undefined;
  const { ctx } = await requireWorkspace(slug);
  const [memories, goals, counts] = await Promise.all([
    recall(ctx, { query: q, kind, limit: MEMORY_PAGE_SIZE }),
    listGoals(ctx, {}),
    countMemoryKinds(ctx, { query: q }),
  ]);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const canWrite = can(ctx.actor, "memory:write");
  const filtered = Boolean(q || kind);

  return (
    <>
      <PageHeader
        title="Memory"
        description="Long-term knowledge shared by every agent in this workspace: facts, preferences, and choices they recall before acting."
      />
      <Card>
        <CardHeader
          title={filtered ? pluralize(memories.length, "match", "matches") : "Everything remembered"}
          description={memories.length === MEMORY_PAGE_SIZE ? `Showing the ${MEMORY_PAGE_SIZE} most relevant.` : "Agents recall this before they act."}
          action={
            canWrite && (
              <Popover variant="ghost" icon={<Plus aria-hidden />} label="Add" title="Remember something">
                <RememberForm slug={slug} goals={goals.filter((goal) => goal.status !== "abandoned")} />
              </Popover>
            )
          }
        />
        <CardBody className="space-y-3 border-b border-rule">
          <SearchForm action={routes.memory(slug)} defaultValue={q} placeholder="Search memory…" label="Search memory" keep={{ kind }} />
          <nav aria-label="Filter by kind" className="flex flex-wrap gap-1.5">
            {[undefined, ...MEMORY_KINDS].map((option) => (
              <Link
                key={option ?? "all"}
                href={routes.memory(slug, { kind: option, q })}
                aria-current={option === kind ? "page" : undefined}
                className={cx(
                  "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors duration-(--dur-micro)",
                  option === kind ? "bg-accent-tint text-accent-ink" : "bg-fill text-ink-2 hover:bg-rule hover:text-ink",
                )}
              >
                {option ? MEMORY_KIND_META[option].label : "All"}
                <span className="figure font-normal">{option ? counts[option] : total}</span>
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
    </>
  );
}
