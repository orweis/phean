import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CumulativeFlow } from "@/components/charts/cumulative-flow";
import { Timetable, TimetableLegend } from "@/components/charts/timetable";
import { GoalFilter } from "@/components/goal-filter";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { segment, SEGMENTED } from "@/components/ui/segmented";
import { pluralize } from "@/lib/format";
import { queryParam, routes } from "@/lib/routes";
import {
  cumulativeFlow,
  groupByGoal,
  journeyTotals,
  parseTimelineDays,
  TIMELINE_WINDOWS,
  windowSpan,
  type JourneyTotals,
  type TimelineDays,
} from "@/lib/timeline";
import { requireWorkspace } from "@/server/auth/session";
import { listGoals } from "@/server/domain/goals";
import { getJourneys } from "@/server/domain/overview";
import { orNotFound } from "@/server/web";

export const metadata: Metadata = { title: "Timeline" };

function WindowSwitch({ slug, goalId, days }: { slug: string; goalId?: string; days: TimelineDays }) {
  return (
    <nav aria-label="Time window" className={SEGMENTED}>
      {TIMELINE_WINDOWS.map((option) => (
        <Link
          key={option}
          href={routes.timeline(slug, { goal: goalId, days: String(option) })}
          aria-current={option === days ? "page" : undefined}
          className={segment(option === days)}
        >
          {option} days
        </Link>
      ))}
    </nav>
  );
}

/** "23 tasks on the line: 9 done, 2 dropped, 12 still open (3 late)." */
function windowSummary({ total, done, dropped, open, late }: JourneyTotals): string {
  if (total === 0) return "No task was open in this window.";
  const parts = [`${done} done`, dropped > 0 && `${dropped} dropped`, `${open} still open${late ? ` (${late} late)` : ""}`].filter(Boolean);
  return `${pluralize(total, "task")} on the line: ${parts.join(", ")}.`;
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
        description={`Where every task stood each day ${windowSpan(window, days)}. ${windowSummary(journeyTotals(journeys, window))}`}
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
          <CumulativeFlow flow={cumulativeFlow(journeys, window)} window={window} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Timetable"
          description={
            truncated
              ? `The ${journeys.length} most recent tasks, grouped by goal. Narrow the window or pick a goal to see the rest.`
              : (
                  <>
                    One track per task, grouped by goal, on the same days as the chart above. A long flat run is stuck work.{" "}
                    <span className="pointer-coarse:hidden">Hover a track to bring it forward.</span>
                  </>
                )
          }
        />
        <CardBody>
          <TimetableLegend className="mb-4" />
          <Timetable window={window} slug={slug} groups={groupByGoal(journeys, goals, slug)} />
        </CardBody>
      </Card>
    </>
  );
}
