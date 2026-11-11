"use client";

import { useSyncExternalStore } from "react";

import { saveDigestAction } from "@/app/w/[slug]/actions";

import { ActionForm } from "./ui/action-form";
import { Field, Select } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

/** The browser's time zone does not change while the page is open, so there is nothing to subscribe to. */
const noSubscription = () => () => {};

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** "07:00": hours as a 24-hour clock reads them, so no locale decides what 7 means. */
const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * When to email the digest: an hour, in the time zone this browser reports (or the one saved before,
 * so changing the hour from another device does not move it).
 */
export function DigestForm({ slug, hour, timeZone }: { slug: string; hour?: number; timeZone?: string }) {
  const browserZone = useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    () => "UTC",
  );
  const zone = timeZone ?? browserZone;
  return (
    <ActionForm action={saveDigestAction} workspace={slug} notice={timeZone ? "Saved when your digest is sent" : "Your morning digest is on"} className="space-y-3">
      <input type="hidden" name="timeZone" value={zone} />
      <div className="w-40">
        <Field label="Send it at" htmlFor="digest-hour" hint={`Your time, ${zone.replaceAll("_", " ")}.`}>
          <Select id="digest-hour" name="hour" defaultValue={hour ?? 8}>
            {HOURS.map((option) => (
              <option key={option} value={option}>
                {clock(option)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <SubmitButton variant={timeZone ? "secondary" : "primary"}>{timeZone ? "Save" : "Email me each morning"}</SubmitButton>
    </ActionForm>
  );
}
