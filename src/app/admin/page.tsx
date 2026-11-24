import type { Metadata } from "next";

import { TrendCard } from "@/components/backoffice/trend-card";
import { TwoFactorGate } from "@/components/backoffice/parts";
import { PageHeader } from "@/components/page-header";
import { Stat, StatStrip } from "@/components/ui/stat";
import { percent, formatDuration } from "@/lib/format";
import { adminPaths } from "@/server/backoffice/paths";
import { getOverview } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";

export const metadata: Metadata = { title: "Overview" };

const ACTIVE = "at least one event as the actor (or, for an agent, one MCP tool call) in the 7 days";

export default async function BackofficeOverviewPage() {
  const access = await requireBackoffice();
  if (access.refusal) return <TwoFactorGate />;
  const { windows, totals, trends } = await getOverview(access.ctx, {});
  const ended = trends.runsEnded.at(-1) ?? 0;
  const succeeded = trends.runsSucceeded.at(-1) ?? 0;
  const timed = trends.answersTimed.at(-1) ?? 0;

  return (
    <>
      <PageHeader
        title="Backoffice"
        description="Every workspace at once. Each week is the 7 days ending on its last day; the latest ends today, so it holds six whole days and today so far. Today counts live; earlier days come from the hourly rollup."
      />
      <StatStrip className="mb-6 grid-cols-1 sm:grid-cols-3">
        <Stat label="Workspaces" value={totals.workspaces.toLocaleString("en")} href={adminPaths.workspaces()} />
        <Stat label="People" value={totals.people.toLocaleString("en")} href={adminPaths.people()} hint="every account, in any workspace or none" />
        <Stat label="Connected agents" value={totals.agents.toLocaleString("en")} href={adminPaths.agents()} hint="not revoked or lapsed" />
      </StatStrip>

      <h2 className="mb-3 text-md font-semibold tracking-title text-ink">Growth and activity</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TrendCard title="New signups" definition="Accounts created in the 7 days (user.created_at)." windows={windows} values={trends.signups} />
        <TrendCard title="New workspaces" definition="Workspaces created in the 7 days (organization.created_at)." windows={windows} values={trends.workspaces} />
        <TrendCard title="Active workspaces" definition={`Weekly active workspaces: ${ACTIVE}, by a person or an agent other than the pipelines agent.`} windows={windows} values={trends.activeWorkspaces} />
        <TrendCard title="Active people" definition={`Weekly active people: ${ACTIVE}, in any workspace. Only reading pages does not count.`} windows={windows} values={trends.activePeople} />
        <TrendCard title="Active agents" definition={`Weekly active agents: ${ACTIVE}. The pipelines agent never counts.`} windows={windows} values={trends.activeAgents} />
      </div>

      <h2 className="mb-3 text-md font-semibold tracking-title text-ink">Decisions and work</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TrendCard title="Decisions asked" definition="Requests agents asked people (task.input_requested): questions and decisions alike." windows={windows} values={trends.decisionsAsked} />
        <TrendCard title="Decisions answered" definition="Requests a person answered, or marked answered elsewhere (task.input_answered)." windows={windows} values={trends.decisionsAnswered} />
        <TrendCard
          title="Median time to answer"
          definition="From an agent asking to a person's answer, over requests answered in the 7 days (tasks.input_answers, outcomes answered and answered elsewhere)."
          windows={windows}
          values={trends.medianAnswerMs}
          format={formatDuration}
          note={timed ? `Over ${timed} answered this week` : "Nothing answered this week"}
        />
        <TrendCard title="Tasks captured" definition="Tasks agents captured or people added (task.captured)." windows={windows} values={trends.tasksCaptured} />
        <TrendCard title="Tasks completed" definition="Tasks completed, or moved to Done (task.completed, and task.updated to done)." windows={windows} values={trends.tasksDone} />
        <TrendCard title="Handoffs" definition="Tasks handed from one operator to another (task.handed_off)." windows={windows} values={trends.handoffs} />
        <TrendCard
          title="Pipeline runs"
          definition="Runs started in the 7 days (pipeline_runs.started_at). Success is the share of runs that ended in the 7 days with status done; failed and cancelled count against it."
          windows={windows}
          values={trends.runsStarted}
          note={ended ? `${percent(succeeded / ended)} of ${ended} ended this week succeeded` : "None ended this week"}
        />
      </div>
    </>
  );
}
