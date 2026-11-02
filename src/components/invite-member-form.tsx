"use client";

import { Link2, UserPlus } from "lucide-react";

import { inviteMemberAction } from "@/app/w/[slug]/actions";
import type { ActionState } from "@/lib/action-state";
import { routes } from "@/lib/routes";

import { ActionForm } from "./ui/action-form";
import { CopyButton } from "./ui/copy-button";
import { Field, Input, Select } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

function createdInvitation(state: ActionState): { invitationId: string; email: string } | null {
  const { invitationId, email } = state.data ?? {};
  return typeof invitationId === "string" && typeof email === "string" ? { invitationId, email } : null;
}

/** Phean does not send email: the invite is a link the inviter shares, accepted by signing in with that address. */
export function InviteMemberForm({ slug, origin }: { slug: string; origin: string }) {
  return (
    <ActionForm action={inviteMemberAction} workspace={slug}>
      {(state) => {
        const invitation = createdInvitation(state);
        const link = invitation && new URL(routes.invite(invitation.invitationId), origin).toString();
        return (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Email" htmlFor="invite-email" className="min-w-56 flex-1">
                <Input id="invite-email" name="email" type="email" required placeholder="teammate@company.com" />
              </Field>
              <Field label="Role" htmlFor="invite-role" className="w-32">
                <Select id="invite-role" name="role" defaultValue="member">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              </Field>
              <SubmitButton variant="primary">
                <UserPlus aria-hidden />
                Invite
              </SubmitButton>
            </div>
            {invitation && link && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
                  <Link2 className="size-4 text-emerald-600" aria-hidden />
                  Send this link to {invitation.email}
                </p>
                <p className="mt-1 text-xs text-zinc-500">They join by signing in or signing up with that address.</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-800">
                    {link}
                  </code>
                  <CopyButton value={link} />
                </div>
              </div>
            )}
          </>
        );
      }}
    </ActionForm>
  );
}
