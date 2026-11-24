import { Gauge } from "lucide-react";
import type { Metadata } from "next";

import { Figure, TableScroll, TwoFactorGate } from "@/components/backoffice/parts";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ProgressBar, Stat, StatStrip } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { share } from "@/lib/backoffice";
import { cx } from "@/lib/cx";
import { percent } from "@/lib/format";
import { getProductUsage } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";

export const metadata: Metadata = { title: "Usage" };

const METHOD_LABELS: Record<string, string> = { credential: "Password", github: "GitHub", google: "Google" };

export default async function AdminUsagePage() {
  const access = await requireBackoffice();
  if (access.refusal) return <TwoFactorGate />;
  const usage = await getProductUsage(access.ctx, {});
  const { people } = usage;

  return (
    <>
      <PageHeader
        title="Usage"
        description={`Which features workspaces use, over the last ${usage.days} days, from the event log; and the settings people keep that no event records. Themes live in a cookie and never reach the server, so they are not measured here.`}
      />
      <StatStrip className="mb-6 grid-cols-2 lg:grid-cols-4">
        <Stat label={`Active workspaces, ${usage.days} days`} value={usage.activeWorkspaces} hint={`of ${usage.workspaces.total}`} />
        <Stat label="Two-factor on" value={percent(share(people.twoFactor, people.total))} hint={`${people.twoFactor} of ${people.total} people`} />
        <Stat label="Push notifications" value={percent(share(people.withDevices, people.total))} hint={`${people.devices} devices, ${people.privateDevices} private`} />
        <Stat label="Custom board stages" value={usage.workspaces.customWorkflow} hint="workspaces with their own stages" />
      </StatStrip>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Feature adoption" description={`Workspaces with at least one of the feature's events in the last ${usage.days} days, as a share of the workspaces active then.`} />
          {usage.activeWorkspaces === 0 ? (
            <EmptyState icon={<Gauge />} title={`No activity in ${usage.days} days`} />
          ) : (
            <ul className="divide-y divide-rule">
              {usage.features.map((feature) => {
                const fraction = share(feature.workspaces, usage.activeWorkspaces);
                return (
                  <li key={feature.key} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5">
                    <span className="truncate text-sm font-semibold text-ink">{feature.label}</span>
                    <ProgressBar value={fraction} label={`${feature.label}: ${percent(fraction)} of active workspaces`} />
                    <span className="w-28 text-right text-xs text-ink-2">
                      <span className="figure font-semibold text-ink">{feature.workspaces}</span> · {percent(fraction)}
                      <span className="block text-muted">{feature.events.toLocaleString("en")} events</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Sign-in methods" description="People with each way of signing in linked to their account; one person may have several." />
            <ul className="divide-y divide-rule">
              {usage.signInMethods.map((method) => (
                <li key={method.method} className="flex justify-between px-5 py-2.5 text-sm">
                  <span className="text-ink">{METHOD_LABELS[method.method] ?? method.method}</span>
                  <span className="figure font-semibold text-ink">{method.people}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Notifications and digests" description="Person-level settings: push devices and the morning digest." />
            <dl className="grid grid-cols-2 gap-4 px-5 py-4 text-sm">
              {[
                ["Devices", people.devices],
                ["Answer from a notification", people.answerFromNotification],
                ["Private devices", people.privateDevices],
                ["Digest subscriptions", people.digests],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="figure text-lg font-bold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader title={`Every action, last ${usage.days} days`} description="Events by action, by people and agents (the pipelines agent left out), and how many workspaces they came from." />
          <TableScroll label="Events by action" className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Events by action</caption>
              <thead>
                <tr className="border-b border-rule">
                  <th scope="col" className={cx(TH, "pl-5 text-left", PINNED_CELL)}>
                    Action
                  </th>
                  <th scope="col" className={cx(TH, "text-right")}>
                    Events
                  </th>
                  <th scope="col" className={cx(TH, "pr-5 text-right")}>
                    Workspaces
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {usage.actions.map((row) => (
                  <tr key={row.action}>
                    <td className={cx("py-2 pr-3 pl-5 font-mono text-xs text-ink", PINNED_CELL)}>{row.action}</td>
                    <td className="px-3 py-2 text-right">
                      <Figure value={row.events} className="font-semibold text-ink" />
                    </td>
                    <td className="py-2 pr-5 pl-3 text-right">
                      <Figure value={row.workspaces} />
                    </td>
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
