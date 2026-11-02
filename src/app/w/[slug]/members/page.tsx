import type { Metadata } from "next";

import { cancelInvitationAction, removeMemberAction } from "@/app/w/[slug]/actions";
import { InviteMemberForm } from "@/components/invite-member-form";
import { PageHeader } from "@/components/page-header";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, MetaBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { ROLE_META } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { can } from "@/server/domain/policy";
import { listMembers, listPendingInvitations, toMemberRole } from "@/server/domain/tenants";
import { absoluteUrl } from "@/server/web";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: PageProps<"/w/[slug]/members">) {
  const { slug } = await params;
  const { ctx } = await requireWorkspace(slug);
  const canManage = can(ctx.actor, "member:manage");
  const [members, invitations, origin] = await Promise.all([
    listMembers(ctx, {}),
    canManage ? listPendingInvitations(ctx, {}) : [],
    absoluteUrl("/"),
  ]);

  return (
    <>
      <PageHeader title="Members" description="People who can see this workspace, decide on goals, and manage its agents." />

      {canManage && (
        <Card className="mb-6">
          <CardHeader
            title="Invite someone"
            description="Admins can manage members and agent tokens. Members can do everything else, including approving goals."
          />
          <CardBody>
            <InviteMemberForm slug={slug} origin={origin} />
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="People" description={`${members.length} with access to this workspace.`} />
          <ul className="divide-y divide-rule">
            {members.map((person) => {
              const isSelf = person.userId === ctx.actor.id;
              return (
                <li key={person.id} className="flex items-center gap-3 px-5 py-3">
                  <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-shell text-xs font-bold text-shell-ink uppercase">
                    {person.name.slice(0, 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <span className="truncate">{person.name}</span>
                      {isSelf && <Badge>You</Badge>}
                    </p>
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                      <span className="truncate">{person.email}</span>
                      <span>Joined {timeAgo(person.joinedAt)}</span>
                    </p>
                  </div>
                  <MetaBadge meta={ROLE_META} value={person.role} />
                  {canManage && !isSelf && person.role !== "owner" && (
                    <ActionForm action={removeMemberAction} workspace={slug} confirm={`Remove ${person.name} from this workspace?`}>
                      <input type="hidden" name="memberId" value={person.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Remove
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        {canManage && (
          <Card className="h-fit">
            <CardHeader title="Pending invitations" />
            {invitations.length === 0 ? (
              <CardBody>
                <p className="text-xs text-muted">No open invitations.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-rule">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="space-y-2 px-5 py-3">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-ink">{invitation.email}</p>
                      <MetaBadge meta={ROLE_META} value={toMemberRole(invitation.role ?? "member")} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="flex-1 text-xs text-muted">Expires {timeAgo(invitation.expiresAt)}</span>
                      <CopyButton value={new URL(routes.invite(invitation.id), origin).toString()} label="Copy link" variant="ghost" />
                      <ActionForm action={cancelInvitationAction} workspace={slug} quiet>
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Cancel
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
