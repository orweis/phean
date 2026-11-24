"use client";

import { setNotificationPreferencesAction } from "@/app/account/actions";
import { NOTIFICATION_TOPIC_META, NOTIFICATION_TOPICS, type NotificationPreferences, type NotificationTopic } from "@/lib/notification-preferences";

import { ActionForm } from "../ui/action-form";

function TopicToggle({ topic, on }: { topic: NotificationTopic; on: boolean }) {
  const { label, hint } = NOTIFICATION_TOPIC_META[topic];
  return (
    <ActionForm key={`${topic}-${on}`} action={setNotificationPreferencesAction} notice={on ? `Turned off “${label}”` : `Turned on “${label}”`}>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" name={topic} value="true" defaultChecked={on} onChange={(event) => event.currentTarget.form?.requestSubmit()} className="mt-0.5 size-4 shrink-0 accent-accent" />
        <span className="min-w-0">
          <span className="font-semibold text-ink">{label}</span>
          <span className="block text-ink-2">{hint}</span>
        </span>
      </label>
      {/* Read when the box is unticked; a ticked box's "true" comes first. */}
      <input type="hidden" name={topic} value="false" />
    </ActionForm>
  );
}

/**
 * What the person is notified about, on every device at once: browsers, the Android app and Phean
 * desktop. What they did themselves never notifies them, so that is said rather than offered.
 */
export function NotificationPreferencesSettings({ preferences }: { preferences: NotificationPreferences }) {
  return (
    <div className="space-y-4">
      {NOTIFICATION_TOPICS.map((topic) => (
        <TopicToggle key={topic} topic={topic} on={preferences[topic]} />
      ))}
      <p className="text-sm text-ink-2">You are never notified about what you did yourself, such as a decision you answered or an answer you took back.</p>
    </div>
  );
}
