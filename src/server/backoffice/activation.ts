import { sql } from "drizzle-orm";
import { z } from "zod";

import { funnel, retentionGrid, TREND_WINDOWS, trailingWindows, type DayWindow, type FunnelPerson, type FunnelStep, type RetentionRow } from "@/lib/backoffice";
import { dayOf, daysBetween, todayIso } from "@/lib/dates";

import { queryRows } from "../db/raw";
import { epochMs, utcDay, windowStart } from "./queries";
import { usageSource } from "./rollup";
import { platformService } from "./service";

export interface Activation {
  windows: DayWindow[];
  steps: FunnelStep[];
  /** People in the cohort who joined someone else's workspace and never created one. */
  invitedOnly: number;
  retention: RetentionRow[];
}

interface CohortRow {
  id: string;
  signedUpAt: number;
  signupDay: string;
  workspaceAt: number | null;
  joinedAt: number | null;
  agentAt: number | null;
  askedAt: number | null;
  answeredAt: number | null;
}

/**
 * Activation: the funnel from signup to an answered decision and activity in weeks 2 and 4, and
 * weekly signup cohorts as a retention grid, for people who signed up in the last twelve weeks.
 */
export const getActivation = platformService("view.activation", z.object({}), async (ctx): Promise<Activation> => {
  const now = new Date();
  const today = todayIso(now);
  const windows = trailingWindows(today, TREND_WINDOWS);
  const from = windowStart(windows[0]!);

  // One row per person in the cohort, with the moment they reached each timed step. The first request
  // is the first in a workspace they own, after they signed up; events are read through their action index.
  const cohort = await queryRows<CohortRow>(
    ctx.db,
    sql`with cohort as (select id, created_at from "user" where created_at >= ${from}::timestamp),
        owned as (select m.user_id, min(m.created_at) as at from member m join cohort c on c.id = m.user_id where m.role = 'owner' group by 1),
        joined as (select m.user_id, min(m.created_at) as at from member m join cohort c on c.id = m.user_id group by 1),
        agent as (select a.created_by_user_id as user_id, min(a.created_at) as at from agents a join cohort c on c.id = a.created_by_user_id
                  where a.auth_kind <> 'system' group by 1),
        asked as (select m.user_id, min(e.created_at) as at from events e
                  join member m on m.organization_id = e.tenant_id and m.role = 'owner'
                  join cohort c on c.id = m.user_id
                  where e.action = 'task.input_requested' and e.created_at >= ${from}::timestamptz and e.created_at >= (c.created_at at time zone 'UTC') group by 1),
        answered as (select e.actor_id as user_id, min(e.created_at) as at from events e join cohort c on c.id = e.actor_id
                     where e.action = 'task.input_answered' and e.actor_type = 'user' and e.created_at >= ${from}::timestamptz group by 1)
        select c.id, ${epochMs(sql`c.created_at`)} as "signedUpAt", ${utcDay(sql`c.created_at`, false)} as "signupDay",
          ${epochMs(sql`owned.at`)} as "workspaceAt", ${epochMs(sql`joined.at`)} as "joinedAt", ${epochMs(sql`agent.at`)} as "agentAt",
          ${epochMs(sql`asked.at`)} as "askedAt", ${epochMs(sql`answered.at`)} as "answeredAt"
        from cohort c
        left join owned on owned.user_id = c.id left join joined on joined.user_id = c.id left join agent on agent.user_id = c.id
        left join asked on asked.user_id = c.id left join answered on answered.user_id = c.id`,
  );

  const source = await usageSource(ctx.db, windows[0]!.from, now);
  const activity = await queryRows<{ userId: string; day: string }>(
    ctx.db,
    sql`select distinct u.actor_id as "userId", u.day from ${source} as u
        where u.day >= ${windows[0]!.from} and u.actor_type = 'user'
          and u.actor_id in (select id from "user" where created_at >= ${from}::timestamp)`,
  );
  const daysOf = new Map<string, string[]>();
  for (const row of activity) daysOf.set(row.userId, [...(daysOf.get(row.userId) ?? []), row.day]);

  const nullable = (value: number | null) => (value === null ? null : Number(value));
  const people: FunnelPerson[] = cohort.map((row) => ({
    signedUpAt: Number(row.signedUpAt),
    signupDay: row.signupDay,
    workspaceAt: nullable(row.workspaceAt),
    agentAt: nullable(row.agentAt),
    askedAt: nullable(row.askedAt),
    answeredAt: nullable(row.answeredAt),
    activeDays: (daysOf.get(row.id) ?? []).map((day) => daysBetween(dayOf(row.signupDay), dayOf(day))),
  }));

  return {
    windows,
    steps: funnel(people, today),
    invitedOnly: cohort.filter((row) => row.workspaceAt === null && row.joinedAt !== null).length,
    retention: retentionGrid(
      cohort.map((row) => ({ signupDay: row.signupDay, activeDays: daysOf.get(row.id) ?? [] })),
      windows,
      today,
    ),
  };
});
