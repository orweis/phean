import { BellOff, BellRing } from "lucide-react";

import { muteWorkspaceAction, unmuteWorkspaceAction } from "@/app/w/[slug]/actions";

import { ActionButton } from "./ui/action-button";

/**
 * The Decisions page's per-workspace mute: no notifications from this workspace on any of the
 * person's devices (its requests still count in the desktop's badge). Undo is the reverse.
 */
export function NotificationMute({ slug, workspaceName, muted }: { slug: string; workspaceName: string; muted: boolean }) {
  return muted ? (
    <ActionButton
      action={unmuteWorkspaceAction}
      workspace={slug}
      fields={{}}
      size="sm"
      variant="secondary"
      notice={`Notifications from ${workspaceName} are on again`}
      undo={{ action: muteWorkspaceAction, fields: {}, done: `Muted notifications from ${workspaceName}` }}
    >
      <BellRing aria-hidden />
      Unmute notifications
    </ActionButton>
  ) : (
    <ActionButton
      action={muteWorkspaceAction}
      workspace={slug}
      fields={{}}
      size="sm"
      variant="ghost"
      notice={`Muted notifications from ${workspaceName}`}
      undo={{ action: unmuteWorkspaceAction, fields: {}, done: `Notifications from ${workspaceName} are on again` }}
    >
      <BellOff aria-hidden />
      Mute notifications
    </ActionButton>
  );
}
