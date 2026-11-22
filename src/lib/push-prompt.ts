/** What the Decisions page knows about this browser when it decides whether to offer notifications. */
export interface PushPromptInput {
  /** The server has a VAPID key pair (notifications can be sent at all). */
  configured: boolean;
  /** The person is a member, so a device of theirs would get decisions. */
  member: boolean;
  /** Inside Phean desktop, which notifies by itself. */
  desktop: boolean;
  /** Service worker, Push API and Notification all exist, and Phean's worker is registered. */
  supported: boolean;
  /** `Notification.permission`. */
  permission: NotificationPermission | "unknown";
  /** This browser already has a push subscription. */
  subscribed: boolean;
  /** The person chose "Not now" here before. */
  dismissed: boolean;
}

/**
 * Whether the Decisions page offers "Notify me on this device": only where a tap can work, and never
 * again once it is on, blocked (the browser would refuse without asking), or set aside.
 */
export function offersPush(input: PushPromptInput): boolean {
  return input.configured && input.member && !input.desktop && input.supported && input.permission !== "denied" && !input.subscribed && !input.dismissed;
}

/** The localStorage key that remembers "Not now" on this device. */
export const PUSH_PROMPT_DISMISSED_KEY = "phean-push-prompt-dismissed";
