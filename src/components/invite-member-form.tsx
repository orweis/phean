"use client";

import { Link2, UserPlus } from "lucide-react";

import { inviteMemberAction } from "@/app/w/[slug]/actions";
import { stringData } from "@/lib/action-state";
import { INVITABLE_ROLES, ROLE_META } from "@/lib/domain";
import { routes } from "@/lib/routes";

import { ActionForm } from "./ui/action-form";
import { CopyField } from "./ui/copy-button";
import { enumOptions, Field, Input, Select } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

/** Phean does not send email: the invite is a link the inviter shares, accepted by signing in with that address. */
export function InviteMemberForm({ slug, origin }: { slug: string; origin: string }) {
  return (
    <ActionForm action={inviteMemberAction} workspace={slug}>
      {(state) => {
        const invitation = stringData(state, "invitationId", "email");
        const link = invitation && new URL(routes.invite(invitation.invitationId), origin).toString();
        return (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Email" htmlFor="invite-email" className="min-w-56 flex-1">
                <Input id="invite-email" name="email" type="email" required placeholder="teammate@company.com" />
              </Field>
              <Field label="Role" htmlFor="invite-role" className="w-32">
                <Select id="invite-role" name="role" defaultValue="member">
                  {enumOptions(INVITABLE_ROLES, ROLE_META)}
                </Select>
              </Field>
              <SubmitButton variant="primary">
                <UserPlus aria-hidden />
                Invite
              </SubmitButton>
            </div>
            {invitation && link && (
              <div className="mt-4 rounded-lg border border-arrive/40 bg-arrive-tint p-4">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <Link2 className="size-4 text-arrive-ink" aria-hidden />
                  Send this link to {invitation.email}
                </p>
                <p className="mt-1 text-xs text-ink-2">They join by signing in or signing up with that address.</p>
                <div className="mt-2">
                  <CopyField value={link} />
                </div>
              </div>
            )}
          </>
        );
      }}
    </ActionForm>
  );
}
