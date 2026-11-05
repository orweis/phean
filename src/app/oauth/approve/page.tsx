import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ApproveAgentForm, DeclineConsentForm } from "@/components/approve-agent-form";
import { CreateWorkspaceForm } from "@/components/create-workspace-form";
import { Logo } from "@/components/logo";
import { Card } from "@/components/ui/card";
import { todayIso } from "@/lib/dates";
import { grantableLevels } from "@/lib/domain";
import { authorizeRetryPath, clientDisplayName, renewalKey } from "@/lib/oauth-consent";
import { queryStringOf, routes } from "@/lib/routes";
import { attempt } from "@/server/actions";
import { auth } from "@/server/auth/auth";
import { readConsentRequest } from "@/server/auth/consent";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { findRenewableAgent } from "@/server/domain/agents";
import { listMemberships, userContext } from "@/server/domain/tenants";

export const metadata: Metadata = { title: "Connect an agent" };

function DialogPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-8">
      <Logo />
      <Card className="px-4 py-5 sm:px-5">
        <h1 className="text-lg font-bold wrap-anywhere text-ink">{title}</h1>
        {children}
      </Card>
    </main>
  );
}

function Refused() {
  return (
    <DialogPage title="This connection request is not valid">
      <p className="mt-1 text-sm text-ink-2">Nothing was connected. Start again from your client.</p>
    </DialogPage>
  );
}

/**
 * The one screen a person sees when connecting an MCP client. A client's metadata is hostile: only
 * its cut-down name is shown, as text, and its home page, logo and policy addresses are never read.
 * The destination shown is the redirect address, which authorize has already matched.
 */
export default async function ApproveAgentPage({ searchParams }: PageProps<"/oauth/approve">) {
  const oauthQuery = queryStringOf(await searchParams);
  const request = await readConsentRequest(auth, oauthQuery);
  if (request.status === "stale") redirect(request.retryPath);
  if (request.status === "invalid") return <Refused />;

  const session = await getSession();
  if (!session) redirect(authorizeRetryPath(oauthQuery));

  const requestHeaders = await headers();
  const client = await attempt(() => auth.api.getOAuthClientPublic({ query: { client_id: request.clientId }, headers: requestHeaders }));
  if (!client.ok) return <Refused />;
  const clientName = clientDisplayName(client.value.client_name);
  const called = clientName || "an unnamed client";

  // Only the person's own memberships, so a platform admin is offered nothing extra here. A client on a
  // workspace's own URL can only be given that workspace, so it is the one offered.
  const memberships = (await listMemberships(getDb(), session.user.id)).filter(({ tenant }) => request.workspace === null || tenant.slug === request.workspace);
  if (request.workspace !== null && memberships.length === 0) {
    return (
      <DialogPage title={`Connect ${called} to Phean`}>
        <p className="mt-1 text-sm text-ink-2">
          This client connects to the address of the workspace <strong className="font-semibold wrap-anywhere text-ink">{request.workspace}</strong>, and you are not a member of it. Ask
          someone in that workspace to connect it, or use the address on your own workspace&apos;s Agents page.
        </p>
        <div className="mt-5">
          <DeclineConsentForm oauthQuery={oauthQuery} clientName={called} />
        </div>
        <p className="mt-4 text-xs text-muted">Signed in as {session.user.name}</p>
      </DialogPage>
    );
  }
  const renewable = clientName
    ? await Promise.all(
        memberships.map(async (membership) => ((await findRenewableAgent(userContext(getDb(), membership, session.user), clientName)) ? renewalKey(membership.tenant.slug, clientName) : null)),
      )
    : [];

  return (
    <DialogPage title={`Connect ${called} to Phean`}>
      <p className="mt-1 text-sm text-ink-2">
        Access goes to <strong className="font-semibold wrap-anywhere text-ink">{request.target.label}</strong>.{" "}
        {clientName ? (
          <>
            <span className="wrap-anywhere">{clientName}</span> is the name this client gave itself. Phean has not checked it.
          </>
        ) : (
          "This client did not give a name."
        )}
      </p>
      {request.target.loopback && (
        <p className="mt-3 rounded-md bg-wait-tint px-3 py-2 text-xs text-wait-ink">
          That address is on this computer. A client&apos;s name proves nothing about which program on it receives access, so allow this only if you started the connection yourself.
        </p>
      )}

      {memberships.length === 0 ? (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-ink-2">An agent works in one workspace, and you have none yet. Create one, and you will come back here.</p>
          <CreateWorkspaceForm next={routes.oauthApprove(oauthQuery)} />
          <DeclineConsentForm oauthQuery={oauthQuery} clientName={called} />
        </div>
      ) : (
        <ApproveAgentForm
          oauthQuery={oauthQuery}
          clientName={called}
          defaultName={clientName}
          workspaces={memberships.map(({ tenant, role }) => ({ slug: tenant.slug, name: tenant.name, levels: grantableLevels(role) }))}
          renewableKeys={renewable.filter((key) => key !== null)}
          today={todayIso()}
        />
      )}
      <p className="mt-4 text-xs text-muted">Signed in as {session.user.name}</p>
    </DialogPage>
  );
}
