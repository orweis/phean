import { Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { TableScroll, TwoFactorGate } from "@/components/backoffice/parts";
import { PageHeader } from "@/components/page-header";
import { SearchForm } from "@/components/search-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/stat";
import { PINNED_CELL, TH } from "@/components/ui/table";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import { queryParam } from "@/lib/routes";
import { adminPaths } from "@/server/backoffice/paths";
import { searchPeople } from "@/server/backoffice";
import { requireBackoffice } from "@/server/backoffice/session";

export const metadata: Metadata = { title: "People" };

const day = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** How a sign-in method reads: Better Auth's provider ids, in words. */
const METHOD_LABELS: Record<string, string> = { credential: "Password", github: "GitHub", google: "Google" };

const HEAD = ["Person", "Signed up", "Signs in with", "Two-factor", "Last session", "Devices", "Workspaces"];

export default async function AdminPeoplePage({ searchParams }: PageProps<"/admin/people">) {
  const access = await requireBackoffice();
  if (access.refusal) return <TwoFactorGate />;
  const q = queryParam((await searchParams).q);
  const { people, limited } = await searchPeople(access.ctx, { q });

  return (
    <>
      <PageHeader
        title="People"
        description="Find a person by email or name: how they sign in, whether two-factor is on, their last session, their devices and workspaces. Passwords, two-factor secrets, sessions and addresses are never shown."
      />
      <div className="mb-4 w-full sm:w-80">
        <SearchForm action={adminPaths.people()} defaultValue={q} placeholder="Email or name" label="Search people" />
      </div>
      <Card>
        <CardHeader title={q ? `Matching “${q}”` : "Newest signups"} description={limited ? "Showing the first 25; search to narrow it down." : undefined} />
        {people.length === 0 ? (
          <EmptyState icon={<Users />} title={q ? "No one matches" : "No one has signed up yet"}>
            {q ? "Try part of their email address." : undefined}
          </EmptyState>
        ) : (
          <TableScroll label="People">
            <table className="w-full text-sm">
              <caption className="sr-only">People</caption>
              <thead>
                <tr className="border-b border-rule">
                  {HEAD.map((label, index) => (
                    <th key={label} scope="col" className={cx(TH, "text-left", index === 0 && cx("pl-5", PINNED_CELL), index === HEAD.length - 1 && "pr-5")}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {people.map((person) => (
                  <tr key={person.id} className="align-top">
                    <td className={cx("max-w-64 py-3 pr-3 pl-5", PINNED_CELL)}>
                      <p className="truncate font-semibold text-ink">{person.name}</p>
                      <p className="truncate text-xs text-ink-2">{person.email}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!person.emailVerified && <Badge tone="neutral">Unverified</Badge>}
                        {person.platformAdmin && <Badge tone="accent">Platform admin</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-ink-2">{day.format(person.createdAt)}</td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-ink-2">{person.methods.map((method) => METHOD_LABELS[method] ?? method).join(", ") || "None"}</td>
                    <td className="px-3 py-3 text-xs">{person.twoFactor ? <Badge tone="success">On</Badge> : <span className="text-muted">Off</span>}</td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-ink-2">
                      {timeAgo(person.lastSessionAt === null ? null : new Date(person.lastSessionAt))}
                      {person.liveSessions > 0 && <span className="block text-muted">{person.liveSessions} signed in</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-xs">{person.devices || <span className="text-muted">None</span>}</td>
                    <td className="py-3 pr-5 pl-3 text-xs">
                      {person.workspaces.length === 0 ? (
                        <span className="text-muted">None</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {person.workspaces.map((workspace) => (
                            <li key={workspace.slug} className="whitespace-nowrap">
                              <Link href={adminPaths.workspace(workspace.slug)} className="link font-semibold text-ink">
                                {workspace.name}
                              </Link>
                              <span className="text-muted"> · {workspace.role}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>
    </>
  );
}
