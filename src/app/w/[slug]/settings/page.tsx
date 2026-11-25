import type { Metadata } from "next";
import { headers } from "next/headers";

import { DeleteWorkspacePopover } from "@/components/delete-workspace";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { WorkflowEditor } from "@/components/workflow-editor";
import { countLabel, DELETION_COUNTS, isRecentSignIn } from "@/lib/workspace-deletion";
import { auth } from "@/server/auth/auth";
import { getSession, requireWorkspace } from "@/server/auth/session";
import { can } from "@/server/domain/policy";
import { getWorkflow } from "@/server/domain/workflow";
import { workspaceInventory } from "@/server/domain/workspace-deletion";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/w/[slug]/settings">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const stages = await getWorkflow(ctx, {});
  const canEdit = can(ctx.actor, "workflow:manage");
  const canDelete = can(ctx.actor, "workspace:delete");

  return (
    <>
      <PageHeader title="Settings" description={`How ${ctx.tenant.name} works. Changes apply to everyone in the workspace and to its agents.`} />
      <Card className="max-w-4xl">
        <CardHeader
          title="Board stages"
          description={
            canEdit
              ? "The lanes tasks move through. Rename or hide each kind's stage, and add your own inside a kind, such as Review before Done. Charts keep counting by kind; agents read these stages from whoami."
              : "The lanes tasks move through. Only workspace owners and admins can change them."
          }
        />
        <CardBody>
          {/* Remounts after a save, so the form always starts from what is stored. */}
          <WorkflowEditor key={JSON.stringify(stages)} slug={slug} stages={stages} canEdit={canEdit} />
        </CardBody>
      </Card>
      {canDelete && <DangerZone slug={slug} name={ctx.tenant.name} counts={await workspaceInventory(ctx, {})} />}
    </>
  );
}

/**
 * Deleting the workspace, for its owner only: what goes with it, counted, and the confirmation
 * panel. The sign-in proofs shown here are a convenience; `deleteWorkspace` checks each again.
 */
async function DangerZone({ slug, name, counts }: { slug: string; name: string; counts: Awaited<ReturnType<typeof workspaceInventory>> }) {
  const [signedIn, accounts] = await Promise.all([getSession(), auth.api.listUserAccounts({ headers: await headers() })]);
  const hasPassword = accounts.some((account) => account.providerId === "credential");
  const twoFactor = Boolean((signedIn?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled);
  const recentSignIn = signedIn ? isRecentSignIn(new Date(signedIn.session.createdAt), new Date()) : false;
  return (
    <Card tone="late" className="mt-6 max-w-4xl" aria-labelledby="danger-zone">
      <CardHeader title={<span id="danger-zone">Danger zone</span>} tone="late" />
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-2">
          Deleting <span className="font-semibold text-ink">{name}</span> deletes everything in it, for every member and agent, at once and for good. Members keep their accounts and other workspaces; they are emailed when email is set up.
        </p>
        <div>
          <h3 className="text-xs font-semibold text-ink-2">What is deleted</h3>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-ink sm:grid-cols-3">
            {DELETION_COUNTS.map((kind) => (
              <li key={kind} className="figure">
                {countLabel(kind, counts[kind])}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">With them go its activity, settings, invitations, webhook deliveries, notification mutes, usage counts, and its agents&rsquo; keys and sign-ins, which stop working at once.</p>
        </div>
        <DeleteWorkspacePopover workspace={{ name, slug }} hasPassword={hasPassword} twoFactor={twoFactor} recentSignIn={recentSignIn} />
      </CardBody>
    </Card>
  );
}
