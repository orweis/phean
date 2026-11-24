import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Fact, TableScroll, TwoFactorGate } from "@/components/backoffice/parts";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { formatBytes, share } from "@/lib/backoffice";
import { cx } from "@/lib/cx";
import { percent, timeAgo } from "@/lib/format";
import { getSystemHealth } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";

export const metadata: Metadata = { title: "Health" };

const ago = (ms: number | null) => (ms === null ? "None" : timeAgo(new Date(ms)));

/** A fact whose figure turns to the late ink when it needs attention, with a word as well as the colour. */
function Watch({ label, value, alert, children }: { label: string; value: ReactNode; alert: boolean; children?: ReactNode }) {
  return (
    <Fact label={label}>
      <span className={alert ? "text-late-ink" : undefined}>{value}</span>
      {alert && <span className="ml-1.5 text-xs font-semibold text-late-ink">Check</span>}
      {children && <span className="block text-xs font-normal text-muted">{children}</span>}
    </Fact>
  );
}

export default async function AdminHealthPage() {
  const access = await requireBackoffice();
  if (access.refusal) return <TwoFactorGate />;
  const health = await getSystemHealth(access.ctx, {});
  const { webhooks, push, pipelines } = health;
  const webhookTried = webhooks.delivered + webhooks.dead;
  const pushTried = push.sent + push.dead;
  const backlogAge = (ms: number | null) => ms !== null && health.readAt - ms > 10 * 60_000;

  return (
    <>
      <PageHeader
        title="Health"
        description="Whether Phean's background work keeps up: deliveries in the last 24 hours and what still waits, pipelines' time limits and schedules the minute sweep has not reached, busy rate limits, the biggest tables, and the usage rollup."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Webhooks" description="Deliveries to agents' endpoints. Success is delivered out of delivered and dead in the last 24 hours; pending is everything still queued." />
          <dl className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-3">
            <Fact label="Active">{webhooks.active}</Fact>
            <Watch label="Disabled" value={webhooks.disabled} alert={webhooks.disabled > 0} />
            <Watch label="Failing" value={webhooks.failing} alert={webhooks.failing > 0} />
            <Watch label="Success, 24 h" value={webhookTried ? percent(share(webhooks.delivered, webhookTried)) : "None"} alert={webhooks.dead > 0}>
              {webhooks.delivered} delivered, {webhooks.dead} dead
            </Watch>
            <Watch label="Pending" value={webhooks.pending} alert={backlogAge(webhooks.oldestPendingAt)}>
              oldest {ago(webhooks.oldestPendingAt)}
            </Watch>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Push notifications" description="Decision notifications to people's devices, the same way." />
          <dl className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-3">
            <Fact label="Devices">{push.devices}</Fact>
            <Watch label="Success, 24 h" value={pushTried ? percent(share(push.sent, pushTried)) : "None"} alert={push.dead > 0}>
              {push.sent} sent, {push.dead} dead
            </Watch>
            <Watch label="Pending" value={push.pending} alert={backlogAge(push.oldestPendingAt)}>
              due {ago(push.oldestPendingAt)}
            </Watch>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Pipelines" description="Runs now, failures in 7 days, and the sweep's lag: time limits more than 2 minutes past, and the oldest point a live schedule has been checked up to." />
          <dl className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-3">
            <Fact label="Live runs">{pipelines.liveRuns}</Fact>
            <Watch label="Failed, 7 days" value={pipelines.failedRuns} alert={pipelines.failedRuns > 0}>
              of {pipelines.endedRuns} ended
            </Watch>
            <Watch label="Overdue limits" value={pipelines.overdueStops} alert={pipelines.overdueStops > 0}>
              oldest {ago(pipelines.oldestOverdueAt)}
            </Watch>
            <Watch label="Schedules" value={pipelines.schedules} alert={backlogAge(pipelines.oldestScheduleCheckAt)}>
              checked {ago(pipelines.oldestScheduleCheckAt)}
            </Watch>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Rollup and streams" description="The hourly usage rollup (the last whole day stored; today is read live) and the agents' realtime streams open now." />
          <dl className="grid grid-cols-2 gap-4 px-5 py-4">
            <Watch label="Rolled up through" value={health.rollup.throughDay ?? "Never"} alert={!health.rollup.ranAt || health.readAt - health.rollup.ranAt.getTime() > 3 * 3_600_000}>
              ran {timeAgo(health.rollup.ranAt)}
            </Watch>
            <Fact label="Realtime streams">{health.realtime.streams}</Fact>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Rate limits, last hour" description="Counters by endpoint, from the shared rate-limit table: how many clients and requests each saw. Client addresses are never read out." />
          {health.rateLimits.length === 0 ? (
            <EmptyState title="No counters in the last hour" />
          ) : (
            <TableScroll label="Rate limits">
              <table className="w-full text-sm">
                <caption className="sr-only">Rate-limit counters by endpoint</caption>
                <thead>
                  <tr className="border-b border-rule">
                    <th scope="col" className={cx(TH, "pl-5 text-left", PINNED_CELL)}>
                      Endpoint
                    </th>
                    <th scope="col" className={cx(TH, "text-right")}>
                      Clients
                    </th>
                    <th scope="col" className={cx(TH, "pr-5 text-right")}>
                      Requests
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {health.rateLimits.map((row) => (
                    <tr key={row.endpoint}>
                      <td className={cx("py-2 pr-3 pl-5 font-mono text-xs text-ink", PINNED_CELL)}>{row.endpoint || "(none)"}</td>
                      <td className="px-3 py-2 text-right">{row.counters}</td>
                      <td className="py-2 pr-5 pl-3 text-right">{row.requests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Card>

        <Card>
          <CardHeader title="Largest tables" description={`Size on disk with indexes (pg_total_relation_size) and estimated rows.${health.databaseBytes ? ` The database holds ${formatBytes(health.databaseBytes)} in all.` : ""}`} />
          <TableScroll label="Largest tables">
            <table className="w-full text-sm">
              <caption className="sr-only">Largest tables</caption>
              <thead>
                <tr className="border-b border-rule">
                  <th scope="col" className={cx(TH, "pl-5 text-left", PINNED_CELL)}>
                    Table
                  </th>
                  <th scope="col" className={cx(TH, "text-right")}>
                    Size
                  </th>
                  <th scope="col" className={cx(TH, "pr-5 text-right")}>
                    Rows
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {health.tables.map((row) => (
                  <tr key={row.table}>
                    <td className={cx("py-2 pr-3 pl-5 font-mono text-xs text-ink", PINNED_CELL)}>{row.table}</td>
                    <td className="px-3 py-2 text-right text-xs">{formatBytes(row.bytes)}</td>
                    <td className="py-2 pr-5 pl-3 text-right text-xs">{Math.round(row.rows).toLocaleString("en")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </div>
    </>
  );
}
