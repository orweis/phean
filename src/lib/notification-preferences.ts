/**
 * What a person may choose to be notified about, on every device: Web Push (browsers and the
 * Android app) and Phean desktop's own notifications. Muting a workspace is separate (its Decisions
 * page); so is never hearing about what the person did themselves, which is not a choice.
 * Client-safe: the Account page and the server read the same table.
 */
export const NOTIFICATION_TOPICS = ["requests", "reopened", "resolved"] as const;
export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

export type NotificationPreferences = Record<NotificationTopic, boolean>;

/** Everything is on until the person turns it off. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { requests: true, reopened: true, resolved: true };

export const NOTIFICATION_TOPIC_META: Record<NotificationTopic, { label: string; hint: string }> = {
  requests: {
    label: "New requests from agents",
    hint: "The moment an agent asks you to decide something. Phean desktop follows this too.",
  },
  reopened: {
    label: "Answers taken back",
    hint: "When someone else takes back their answer, so the request is open again.",
  },
  resolved: {
    label: "Answered or closed elsewhere",
    hint: "Replaces a request's notification once someone else answers it or its agent closes it. Off, the old one stays until you open it.",
  },
};
