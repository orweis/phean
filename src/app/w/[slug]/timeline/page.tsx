import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CumulativeFlow } from "@/components/charts/cumulative-flow";
import { FlowLegend } from "@/components/charts/flow-bar";
import { groupByGoal, Timetable, TimetableLegend } from "@/components/charts/timetable";
import { GoalFilter } from "@/components/goal-filter";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { isOpenTaskStatus } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { isPastDue, pluralize } from "@/lib/format";
import { queryParam, routes } from "@/lib/routes";
import { cumulativeFlow, parseTimelineDays, TIMELINE_WINDOWS, type Journey, type TimelineDays, type TimeWindow } from "@/lib/timeline";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals } from "@/server/domain/goals";
import { getJourneys } from "@/server/domain/overview";
import type { TaskView } from "@/server/domain/tasks";
import { orNotFound } from "@/server/web";

export const metadata: Metadata = { title: "Timeline" };

function WindowSwitch({ slug, goalId, days }: { slug: string; goalId?: string; days: TimelineDays }) {
  return (
    <nav aria-label="Time window" className="flex rounded-md border border-rule bg-panel p-0.5">
      {TIMELINE_WINDOWS.map((option) => (
        <Link
          key={option}
          href={routes.timeline(slug, { goal: goalId, days: String(option) })}
          aria-current={option === days ? "page" : undefined}
          className={cx(
            "rounded-sm px-2.5 py-1.5 text-xs font-semibold transition-colors duration-(--dur-micro)",
            option === days ? "bg-shell text-shell-ink" : "text-ink-2 hover:bg-sunken hover:text-ink",
          )}
        >
          {option} days
        </Link>
      ))}
    </nav>
  );
}

/** "23 tasks were on the line: 9 done, 2 dropped, 12 still open (3 late)." */
function windowSummary(journeys: readonly Journey<TaskView>[], window: TimeWindow): string {
  if (journeys.length === 0) return "No task was open in this window.";
  const doneInWindow = journeys.filter(({ task }) => task.status === "done" && task.completedAt && task.completedAt >= window.start).length;
  const dropped = journeys.filter(({ task }) => task.status === "dropped").length;
  const open = journeys.filter(({ task }) => isOpenTaskStatus(task.status));
  const late = open.filter(({ task }) => isPastDue(task.dueDate)).length;
  const parts = [`${doneInWindow} done`, dropped > 0 && `${dropped} dropped`, `${open.length} still open${late ? ` (${late} late)` : ""}`].filter(Boolean);
  return `${pluralize(journeys.length, "task")} on the line: ${parts.join(", ")}.`;
}

export default async function TimelinePage({ params, searchParams }: PageProps<"/w/[slug]/timeline">) {
  const { slug } = await params;
  const query = await searchParams;
  const goalId = queryParam(query.goal);
  const days = parseTimelineDays(queryParam(query.days));
  const { ctx } = await requireWorkspace(slug);
  const [{ window, journeys, truncated }, goals] = await Promise.all([orNotFound(getJourneys(ctx, { goalId, days })), listGoals(ctx, {})]);

  return (
    <>
      <PageHeader
        title="Timeline"
        description={`Where every task stood each day for the last ${days} days. ${windowSummary(journeys, window)}`}
        actions={
          <>
            <WindowSwitch slug={slug} goalId={goalId} days={days} />
            <Suspense>
              <GoalFilter goals={goals} />
            </Suspense>
          </>
        }
      />

      <Card className="mb-6">
        <CardHeader title="How the work moved" description="Tasks at each status at the end of each day. A widening band is work piling up." />
        <CardBody>
          <CumulativeFlow flow={cumulativeFlow(journeys, window)} />
          <FlowLegend className="mt-4" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Timetable"
          description={
            truncated
              ? `The ${journeys.length} most recent tasks, grouped by goal. Narrow the window or pick a goal to see the rest.`
              : "One track per task, grouped by goal. A long flat run is stuck work. Hover a track to bring it forward."
          }
        />
        <CardBody>
          <TimetableLegend className="mb-4" />
          <Timetable window={window} groups={groupByGoal(journeys, goals, slug)} />
        </CardBody>
      </Card>
    </>
  );
}
