import { and, count, gt, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { distinctByWindow, median, sumByWindow, TREND_WINDOWS, trailingWindows, windowIndexOf, type DayWindow } from "@/lib/backoffice";
import { isoDate, todayIso } from "@/lib/dates";

import { queryRows } from "../db/raw";
import { agents, organization, user } from "../db/schema";
import { actionsPerDay, activeActors, answerDurations, countPerDay, utcDay, windowStart } from "./queries";
import { platformService } from "./service";

/** The figures the overview trends, one value per window, oldest first. */
export interface OverviewTrends {
  signups: number[];
  workspaces: number[];
  activeWorkspaces: number[];
  activePeople: number[];
  activeAgents: number[];
  decisionsAsked: number[];
  decisionsAnswered: number[];
  /** Median ms from asking to a person's answer, per window; null where nothing was answered. */
  medianAnswerMs: (number | null)[];
  answersTimed: number[];
  tasksCaptured: number[];
  tasksDone: number[];
  handoffs: number[];
  runsStarted: number[];
  runsEnded: number[];
  runsSucceeded: number[];
}

export interface Overview {
  windows: DayWindow[];
  totals: { workspaces: number; people: number; agents: number };
  trends: OverviewTrends;
}

const TREND_ACTIONS = ["task.input_requested", "task.input_answered", "task.captured", "task.done", "task.handed_off"] as const;

/**
 * The backoffice's front page: totals now, and twelve trailing weeks of signups, activity, decisions,
 * tasks, handoffs and pipeline runs. Definitions in docs/backoffice/PLAN.md.
 */
export const getOverview = platformService("view.overview", z.object({}), async (ctx): Promise<Overview> => {
  const now = new Date();
  const windows = trailingWindows(todayIso(now), TREND_WINDOWS);
  const fromDay = windows[0]!.from;
  const from = windowStart(windows[0]!);
  const db = ctx.db;

  const [[workspaceTotal], [peopleTotal], [agentTotal], signups, created, perAction, actors, answers, runs] = await Promise.all([
    db.select({ value: count() }).from(organization),
    db.select({ value: count() }).from(user),
    db
      .select({ value: count() })
      .from(agents)
      .where(and(ne(agents.authKind, "system"), isNull(agents.revokedAt), or(isNull(agents.accessExpiresAt), gt(agents.accessExpiresAt, now)))),
    countPerDay(db, sql`"user"`, sql`created_at`, from, false),
    countPerDay(db, sql`organization`, sql`created_at`, from, false),
    actionsPerDay(db, fromDay, TREND_ACTIONS, now),
    activeActors(db, fromDay, now),
    answerDurations(db, from),
    queryRows<{ startDay: string; endDay: string | null; status: string }>(
      db,
      sql`select ${utcDay(sql`started_at`)} as "startDay", ${utcDay(sql`ended_at`)} as "endDay", status::text as status
          from pipeline_runs where started_at >= ${from}::timestamptz or ended_at >= ${from}::timestamptz`,
    ),
  ]);

  const byAction = (action: string) => sumByWindow(perAction.filter((row) => row.action === action), windows);
  const answerWindows = windows.map(() => [] as number[]);
  for (const answer of answers) {
    const index = windowIndexOf(isoDate(new Date(answer.closedAt)), windows);
    if (index >= 0) answerWindows[index]!.push(answer.ms);
  }
  const runRows = (pick: (run: (typeof runs)[number]) => string | null, keep: (run: (typeof runs)[number]) => boolean = () => true) =>
    sumByWindow(
      runs.filter(keep).flatMap((run) => (pick(run) ? [{ day: pick(run)!, value: 1 }] : [])),
      windows,
    );

  return {
    windows,
    totals: { workspaces: workspaceTotal?.value ?? 0, people: peopleTotal?.value ?? 0, agents: agentTotal?.value ?? 0 },
    trends: {
      signups: sumByWindow(signups, windows),
      workspaces: sumByWindow(created, windows),
      activeWorkspaces: distinctByWindow(actors.map((row) => ({ day: row.day, key: row.tenantId })), windows),
      activePeople: distinctByWindow(actors.filter((row) => row.actorType === "user").map((row) => ({ day: row.day, key: row.actorId })), windows),
      activeAgents: distinctByWindow(actors.filter((row) => row.actorType === "agent").map((row) => ({ day: row.day, key: row.actorId })), windows),
      decisionsAsked: byAction("task.input_requested"),
      decisionsAnswered: byAction("task.input_answered"),
      medianAnswerMs: answerWindows.map((durations) => median(durations)),
      answersTimed: answerWindows.map((durations) => durations.length),
      tasksCaptured: byAction("task.captured"),
      tasksDone: byAction("task.done"),
      handoffs: byAction("task.handed_off"),
      runsStarted: runRows((run) => run.startDay),
      runsEnded: runRows((run) => run.endDay, (run) => run.status === "done" || run.status === "failed" || run.status === "cancelled"),
      runsSucceeded: runRows((run) => run.endDay, (run) => run.status === "done"),
    },
  };
});

