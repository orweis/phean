"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { deleteWorkspaceAction } from "@/app/w/[slug]/actions";
import { LIMITS } from "@/lib/domain";
import { confirmsWorkspace, RECENT_SIGN_IN_MINUTES } from "@/lib/workspace-deletion";

import { ActionForm } from "./ui/action-form";
import { Field, Input } from "./ui/field";
import { Popover, PopoverCancel } from "./ui/popover";
import { SubmitButton } from "./ui/submit-button";

interface DeleteWorkspaceProps {
  workspace: { name: string; slug: string };
  /** The proofs the owner's account asks for; the server checks each again whatever this shows. */
  hasPassword: boolean;
  twoFactor: boolean;
  /** For someone without a password: whether they signed in recently enough to delete now. */
  recentSignIn: boolean;
}

/**
 * The Danger zone's confirmation: the workspace's name typed exactly, the owner's password (or a
 * recent sign-in, for GitHub and Google only) and their two-factor code. The delete button stays
 * disabled until the name matches; the server checks every factor regardless.
 */
export function DeleteWorkspacePopover({ workspace, hasPassword, twoFactor, recentSignIn }: DeleteWorkspaceProps) {
  const [typed, setTyped] = useState("");
  const matches = confirmsWorkspace(typed, workspace);
  const id = (field: string) => `delete-workspace-${field}`;

  return (
    <Popover label="Delete workspace" icon={<Trash2 aria-hidden />} variant="danger" size="md" align="left" title="Delete workspace">
      <ActionForm action={deleteWorkspaceAction} workspace={workspace.slug} className="space-y-3">
        <p className="text-sm text-ink-2">
          This deletes <span className="font-semibold text-ink">{workspace.name}</span> and everything in it for every member, now. It cannot be undone.
        </p>
        <Field label={`Type “${workspace.name}” to confirm`} htmlFor={id("confirm")} hint={`Its URL, ${workspace.slug}, works too.`}>
          <Input
            id={id("confirm")}
            name="confirm"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            maxLength={LIMITS.name}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </Field>
        {hasPassword ? (
          <Field label="Your password" htmlFor={id("password")}>
            <Input id={id("password")} name="password" type="password" autoComplete="current-password" required maxLength={LIMITS.passwordMax} />
          </Field>
        ) : (
          !recentSignIn && (
            <p className="rounded-md border border-wait/40 bg-wait-tint px-3 py-2 text-xs text-wait-ink">
              You sign in with GitHub or Google, so Phean asks for a fresh sign-in instead of a password: sign out and in again, then delete within {RECENT_SIGN_IN_MINUTES} minutes.
            </p>
          )
        )}
        {twoFactor && (
          <Field label="Two-factor code" htmlFor={id("code")} hint="The 6-digit code from your authenticator app.">
            <Input id={id("code")} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required maxLength={7} />
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton size="sm" variant="danger" disabled={!matches}>
            Delete this workspace
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}
