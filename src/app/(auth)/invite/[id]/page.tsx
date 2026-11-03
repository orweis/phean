import { Check } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { acceptInvitationAction } from "@/app/workspaces/actions";
import { SignOutButton } from "@/components/sign-out-button";
import { ActionButton } from "@/components/ui/action-button";
import { ButtonLink } from "@/components/ui/button";
import { ROLE_META } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { getViewer } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { findInvitation } from "@/server/domain/tenants";

export const metadata: Metadata = { title: "Invitation" };

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h1 className="text-xl font-extrabold text-ink">{title}</h1>
      <div className="mt-2 space-y-4 text-sm text-ink-2">{children}</div>
    </>
  );
}

export default async function InvitePage({ params }: PageProps<"/invite/[id]">) {
  const { id } = await params;
  const [viewer, invitation] = await Promise.all([getViewer(), findInvitation(getDb(), id)]);
  if (!invitation) notFound();
  const { tenant } = invitation;

  if (viewer.memberships.some((membership) => membership.tenant.id === tenant.id)) {
    return (
      <Message title={`You're in ${tenant.name}`}>
        <p>You are already a member of this workspace.</p>
        <ButtonLink href={routes.workspace(tenant.slug)} variant="primary" className="w-full">
          Open {tenant.name}
        </ButtonLink>
      </Message>
    );
  }

  if (invitation.status !== "pending" || invitation.expiresAt < new Date()) {
    return (
      <Message title="This invitation is no longer valid">
        <p>It was already used, cancelled, or has expired. Ask {invitation.inviterName} to send a new one.</p>
        <ButtonLink href={routes.workspaces()} className="w-full">
          Go to your workspaces
        </ButtonLink>
      </Message>
    );
  }

  if (invitation.email.toLowerCase() !== viewer.user.email.toLowerCase()) {
    return (
      <Message title="Wrong account">
        <p>
          This invitation to <strong className="text-ink">{tenant.name}</strong> is for{" "}
          <strong className="text-ink">{invitation.email}</strong>, but you are signed in as {viewer.user.email}.
        </p>
        <SignOutButton redirectTo={routes.signIn(routes.invite(id))} label={`Sign in as ${invitation.email}`} variant="secondary" />
      </Message>
    );
  }

  return (
    <Message title={`Join ${tenant.name}`}>
      <p>
        {invitation.inviterName} invited you to join as{" "}
        <strong className="text-ink">{ROLE_META[invitation.role].label.toLowerCase()}</strong>. You will
        see the workspace&apos;s goals, tasks, memory, and agents.
      </p>
      <ActionButton action={acceptInvitationAction} fields={{ invitationId: invitation.id }} variant="primary" className="w-full">
        <Check aria-hidden />
        Accept invitation
      </ActionButton>
    </Message>
  );
}
