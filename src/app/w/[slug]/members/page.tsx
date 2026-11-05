import { UserPlus } from "lucide-react";
import type { Metadata } from "next";

import { cancelInvitationAction, removeMemberAction } from "@/app/w/[slug]/actions";
import { InviteMemberForm } from "@/components/invite-member-form";
import { PageHeader } from "@/components/page-header";
import { ActionButton } from "@/components/ui/action-button";
import { Avatar } from "@/components/ui/avatar";
import { Badge, MetaBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Popover } from "@/components/ui/popover";
import { ROLE_META } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { requireWorkspace } from "@/server/auth/session";
import { can } from "@/server/domain/policy";
import { listMembers, listPendingInvitations } from "@/server/domain/tenants";
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

      {/* The team first; inviting someone is a panel in its header, not a form across the page. */}
      <div className="max-w-4xl space-y-6">
        <Card>
          <CardHeader
            title="People"
            description={`${members.length} with access to this workspace.`}
            action={
              canManage && (
                <Popover variant="ghost" icon={<UserPlus aria-hidden />} label="Invite" title="Invite someone" className="sm:w-96">
                  <p className="mb-3 text-xs text-muted">Admins can manage members and agent tokens. Members can do everything else, including approving goals.</p>
                  <InviteMemberForm slug={slug} origin={origin} />
                </Popover>
              )
            }
          />
          <ul className="divide-y divide-rule">
            {members.map((person) => {
              const isSelf = person.userId === ctx.actor.id;
              return (
                <li key={person.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={person.name} />
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
                    <ActionButton
                      action={removeMemberAction}
                      workspace={slug}
                      fields={{ memberId: person.id }}
                      confirm={`Remove ${person.name} from this workspace?`}
                      size="sm"
                      variant="ghost"
                    >
                      Remove
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        {canManage && invitations.length > 0 && (
          <Card>
            <CardHeader title="Pending invitations" description="Each link works once, until it expires." />
            <ul className="divide-y divide-rule">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="space-y-2 px-5 py-3">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-ink">{invitation.email}</p>
                      <MetaBadge meta={ROLE_META} value={invitation.role} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="flex-1 text-xs text-muted">Expires {timeAgo(invitation.expiresAt)}</span>
                      <CopyButton value={new URL(routes.invite(invitation.id), origin).toString()} label="Copy link" variant="ghost" />
                      <ActionButton action={cancelInvitationAction} workspace={slug} fields={{ invitationId: invitation.id }} size="sm" variant="ghost">
                        Cancel
                      </ActionButton>
                    </div>
                  </li>
                ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
