import { sql } from "drizzle-orm";
import { z } from "zod";

import { ADOPTION_FEATURES, REPORT_DAYS, type AdoptionFeature } from "@/lib/backoffice";
import { addDays, dayOf, isoDate, todayIso } from "@/lib/dates";

import { queryRows } from "../db/raw";
import { usageSource } from "./rollup";
import { platformService } from "./service";

export interface ProductUsage {
  days: number;
  activeWorkspaces: number;
  features: { key: AdoptionFeature; label: string; workspaces: number; events: number }[];
  actions: { action: string; events: number; workspaces: number }[];
  signInMethods: { method: string; people: number }[];
  people: { total: number; twoFactor: number; withDevices: number; devices: number; privateDevices: number; answerFromNotification: number; digests: number };
  workspaces: { total: number; customWorkflow: number };
}

/**
 * Which features workspaces use (from the event log, by `ADOPTION_FEATURES`), every action's volume,
 * and the person-level settings no event records: sign-in methods, two-factor, push devices, digests.
 */
export const getProductUsage = platformService("view.usage", z.object({}), async (ctx): Promise<ProductUsage> => {
  const now = new Date();
  const fromDay = isoDate(addDays(dayOf(todayIso(now)), -(REPORT_DAYS - 1)));
  const source = await usageSource(ctx.db, fromDay, now);

  const [actions, [active], methods, [people], [workspaces]] = await Promise.all([
    queryRows<{ action: string; events: number; workspaces: number }>(
      ctx.db,
      sql`select u.action, sum(u.events)::int as events, count(distinct u.tenant_id)::int as workspaces from ${source} as u
          where u.day >= ${fromDay} and u.actor_type in ('user', 'agent') and u.action <> 'task.done' group by 1 order by 2 desc`,
    ),
    queryRows<{ count: number }>(
      ctx.db,
      sql`select count(distinct tenant_id)::int as count from (
            select u.tenant_id from ${source} as u where u.day >= ${fromDay} and u.actor_type in ('user', 'agent')
            union select tenant_id from tool_calls_daily where day >= ${fromDay}::date) as active`,
    ),
    queryRows<{ method: string; people: number }>(ctx.db, sql`select provider_id as method, count(distinct user_id)::int as people from account group by 1 order by 2 desc`),
    queryRows<ProductUsage["people"]>(
      ctx.db,
      sql`select (select count(*)::int from "user") as total,
            (select count(*)::int from "user" where two_factor_enabled) as "twoFactor",
            (select count(distinct user_id)::int from push_devices) as "withDevices",
            (select count(*)::int from push_devices) as devices,
            (select count(*)::int from push_devices where private) as "privateDevices",
            (select count(*)::int from push_devices where answer_from_notification) as "answerFromNotification",
            (select count(*)::int from digest_subscriptions) as digests`,
    ),
    queryRows<ProductUsage["workspaces"]>(
      ctx.db,
      sql`select (select count(*)::int from organization) as total, (select count(*)::int from workspace_settings where workflow <> '[]'::jsonb) as "customWorkflow"`,
    ),
  ]);

  // Distinct workspaces per feature need the rows, not the per-action counts: one workspace may use several of a feature's actions.
  const featureRows = await queryRows<{ feature: string; workspaces: number; events: number }>(
    ctx.db,
    sql`select f.feature, count(distinct u.tenant_id)::int as workspaces, coalesce(sum(u.events), 0)::int as events
        from (values ${sql.join(
          ADOPTION_FEATURES.flatMap((feature) => feature.actions.map((action) => sql`(${feature.key}, ${action})`)),
          sql`, `,
        )}) as f(feature, action)
        join ${source} as u on u.action = f.action and u.day >= ${fromDay} and u.actor_type in ('user', 'agent')
        group by 1`,
  );

  const toNumbers = <T extends Record<string, unknown>>(row: T | undefined) =>
    Object.fromEntries(Object.entries(row ?? {}).map(([key, value]) => [key, Number(value ?? 0)])) as { [K in keyof T]: number };

  return {
    days: REPORT_DAYS,
    activeWorkspaces: Number(active?.count ?? 0),
    features: ADOPTION_FEATURES.map((feature) => {
      const row = featureRows.find((candidate) => candidate.feature === feature.key);
      return { key: feature.key, label: feature.label, workspaces: Number(row?.workspaces ?? 0), events: Number(row?.events ?? 0) };
    }),
    actions: actions.map((row) => ({ action: row.action, events: Number(row.events), workspaces: Number(row.workspaces) })),
    signInMethods: methods.map((row) => ({ method: row.method, people: Number(row.people) })),
    people: toNumbers(people),
    workspaces: toNumbers(workspaces),
  };
});
