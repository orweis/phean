import { UserPlus } from "lucide-react";
import type { Metadata } from "next";

import { Figure, TableScroll, TwoFactorGate } from "@/components/backoffice/parts";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ProgressBar } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { retentionStep, windowLabel } from "@/lib/backoffice";
import { cx } from "@/lib/cx";
import { formatDuration, percent } from "@/lib/format";
import { getActivation } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";

export const metadata: Metadata = { title: "Activation" };

/** A retention cell's wash, by `retentionStep`; the percentage is always printed too. */
const WASH = ["", "bg-accent/8", "bg-accent/16", "bg-accent/26", "bg-accent/36"] as const;

const STEP_NOTES: Record<string, string> = {
  signed_up: "Accounts created in the last 12 weeks.",
  workspace: "Became the owner of a workspace (their first owner membership).",
  agent: "Approved or issued their first agent (agents.created_by_user_id).",
  asked: "An agent asked the first request in a workspace they own, after they signed up.",
  answered: "They answered their first request (task.input_answered as the actor).",
  week2: "Acted on days 7 to 13 after signup. Only people who signed up at least 14 days ago.",
  week4: "Acted on days 21 to 27 after signup. Only people who signed up at least 28 days ago.",
};

export default async function ActivationPage() {
  const access = await requireBackoffice();
  if (access.refusal) return <TwoFactorGate />;
  const { steps, invitedOnly, retention, windows } = await getActivation(access.ctx, {});
  const cohort = steps[0]!.count;

  return (
    <>
      <PageHeader
        title="Activation"
        description="People who signed up in the last 12 weeks: how far they got, how fast, and whether they came back. A step counts only people who reached every step before it."
      />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Funnel" description="Rates are from the step before and from signup, among the people a step could apply to. Times are medians between steps, over the people who reached both." />
          {cohort === 0 ? (
            <EmptyState icon={<UserPlus />} title="No signups in these 12 weeks">
              The funnel fills as people sign up.
            </EmptyState>
          ) : (
            <ol className="divide-y divide-rule">
              {steps.map((step, index) => (
                <li key={step.key} className="grid gap-x-6 gap-y-1.5 px-5 py-3.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,16rem)] sm:items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {index + 1}. {step.label}
                    </p>
                    <p className="text-xs text-muted">{STEP_NOTES[step.key]}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <ProgressBar value={step.fromStart} label={`${step.label}: ${percent(step.fromStart)} of signups`} className="flex-1" />
                    <span className="figure w-14 text-right text-lg font-bold text-ink">{step.count.toLocaleString("en")}</span>
                  </div>
                  <p className="text-xs text-ink-2 sm:text-right">
                    {index === 0 ? (
                      "Everyone in the cohort"
                    ) : (
                      <>
                        <span className="font-semibold text-ink">{percent(step.fromPrevious)}</span> of the step before
                        {" · "}
                        {percent(step.fromStart)} of {step.eligible === cohort ? "signups" : `${step.eligible} eligible`}
                        {step.medianFromPrevious !== null && step.medianOver > 0 && (
                          <span className="block text-muted">
                            Median {formatDuration(step.medianFromPrevious)} after the step before, of {step.medianOver}
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {invitedOnly > 0 && (
            <p className="border-t border-rule px-5 py-3 text-xs text-muted">
              {invitedOnly} {invitedOnly === 1 ? "person" : "people"} in the cohort joined someone else&apos;s workspace and never created one, so they stop at step 2.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Retention by signup week"
            description="Each row is the people who signed up in one week; each column a week since their signup (week 0 is their first 7 days). A cell is the share who acted that week. Weeks not over yet for the whole row stay blank."
          />
          <TableScroll label="Share of each signup week active in each week since signup">
            <table className="w-full text-xs">
              <caption className="sr-only">Share of each signup week active in each week since signup</caption>
              <thead>
                <tr className="border-b border-rule">
                  <th scope="col" className={cx(TH, "pl-5 text-left", PINNED_CELL)}>
                    Signed up
                  </th>
                  <th scope="col" className={cx(TH, "text-right")}>
                    People
                  </th>
                  {windows.map((_, week) => (
                    <th key={week} scope="col" className={cx(TH, "text-center")}>
                      {week === 0 ? (
                        "Week 0"
                      ) : (
                        <>
                          <span className="sr-only">Week </span>
                          {week}
                        </>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {[...retention].reverse().map((row) => (
                  <tr key={row.window.to}>
                    <th scope="row" className={cx("py-2 pr-3 pl-5 text-left font-semibold whitespace-nowrap text-ink", PINNED_CELL)}>
                      {windowLabel(row.window)}
                    </th>
                    <td className="px-3 py-2 text-right">
                      <Figure value={row.size} className="figure font-semibold text-ink" />
                    </td>
                    {row.cells.map((cell, week) => (
                      <td key={week} className={cx("px-1.5 py-2 text-center whitespace-nowrap", cell !== null && WASH[retentionStep(cell)], cell === null ? "text-muted" : "text-ink")}>
                        {cell === null ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="sr-only">not yet</span>
                          </>
                        ) : (
                          percent(cell)
                        )}
                      </td>
                    ))}
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
