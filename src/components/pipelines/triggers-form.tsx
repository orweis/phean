"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { updatePipelineAction } from "@/app/w/[slug]/actions";
import { stringData } from "@/lib/action-state";
import { LIMITS, SOURCE_META, SOURCES, type Source } from "@/lib/domain";
import { formatDay } from "@/lib/format";
import { nextFiring } from "@/lib/pipeline-stats";
import { cronProblem, isTimeZone } from "@/lib/pipelines";
import { sendTracked, type Tracked } from "@/lib/tracked";

import { CopyField } from "../ui/copy-button";
import { ActionForm } from "../ui/action-form";
import { Button } from "../ui/button";
import { Field, Input, Select } from "../ui/field";
import { SubmitButton } from "../ui/submit-button";

interface Triggers {
  schedule: { cron: string; timeZone: string } | null;
  events: { tag: string | null; source: Source | null }[];
  webhook: { url: string } | null;
}

const clock = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/**
 * What starts a regular pipeline's runs besides people and agents: a schedule (five-field cron in a
 * time zone, at most hourly), tasks captured with a tag or from a source, and an inbound webhook whose
 * secret is shown once, when it is turned on. Triggers are people's to set; agents propose stops.
 */
export function TriggersForm({ slug, pipelineId, triggers, origin }: { slug: string; pipelineId: string; triggers: Triggers; origin: string }) {
  const [scheduled, setScheduled] = useState(Boolean(triggers.schedule));
  const [cron, setCron] = useState(triggers.schedule?.cron ?? "0 9 * * 1");
  const [timeZone, setTimeZone] = useState(triggers.schedule?.timeZone ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"));
  const [events, setEvents] = useState(triggers.events.map((event) => ({ tag: event.tag ?? "", source: event.source ?? "" })));
  const [webhook, setWebhook] = useState(Boolean(triggers.webhook));
  const cronIssue = scheduled ? cronProblem(cron) : null;
  const zoneIssue = scheduled && !isTimeZone(timeZone) ? "Unknown time zone: use one like Europe/Berlin." : null;
  const next = scheduled && !cronIssue && !zoneIssue ? nextFiring(cron, timeZone, new Date()) : null;
  const value = {
    schedule: scheduled ? { cron, timeZone } : null,
    events: events.filter((event) => event.tag.trim() || event.source).map((event) => ({ ...(event.tag.trim() && { tag: event.tag.trim() }), ...(event.source && { source: event.source }) })),
    webhook,
  };
  // One `trigger_edit` per kind of trigger this save changes.
  const before = { schedule: triggers.schedule, events: triggers.events.map((event) => ({ ...(event.tag && { tag: event.tag }), ...(event.source && { source: event.source }) })) };
  const edited: Tracked[] = [
    JSON.stringify(value.schedule) !== JSON.stringify(before.schedule) && ("schedule" as const),
    JSON.stringify(value.events) !== JSON.stringify(before.events) && ("event" as const),
    webhook !== Boolean(triggers.webhook) && ("webhook" as const),
  ]
    .filter((type) => type !== false)
    .map((type) => ({ event: "trigger_edit", params: { trigger_type: type } }));

  return (
    <ActionForm
      action={updatePipelineAction}
      workspace={slug}
      analytics={() => {
        edited.slice(1).forEach(sendTracked);
        return edited[0];
      }}
      className="space-y-4"
    >
      {(state) => {
        const secret = stringData(state, "webhookSecret");
        return (
          <>
            <input type="hidden" name="pipelineId" value={pipelineId} />
            <input type="hidden" name="triggers" value={JSON.stringify(value)} />
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-ink-2">Schedule</legend>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={scheduled} onChange={(event) => setScheduled(event.target.checked)} />
                Start a run on a schedule
              </label>
              {scheduled && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="When (cron)" htmlFor="trigger-cron" hint={cronIssue ?? (next ? `Next: ${formatDay(next)}, ${clock.format(next)}` : "Minute hour day month weekday, at most hourly.")}>
                    <Input id="trigger-cron" value={cron} onChange={(event) => setCron(event.target.value)} aria-invalid={Boolean(cronIssue) || undefined} />
                  </Field>
                  <Field label="Time zone" htmlFor="trigger-zone" hint={zoneIssue ?? undefined}>
                    <Input id="trigger-zone" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} aria-invalid={Boolean(zoneIssue) || undefined} />
                  </Field>
                </div>
              )}
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-ink-2">When a task is captured</legend>
              {events.map((event, index) => (
                <div key={`event-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                  <Field label="With the tag" htmlFor={`trigger-tag-${index}`}>
                    <Input id={`trigger-tag-${index}`} value={event.tag} maxLength={LIMITS.tag} onChange={(change) => setEvents(events.map((entry, at) => (at === index ? { ...entry, tag: change.target.value } : entry)))} />
                  </Field>
                  <Field label="From" htmlFor={`trigger-source-${index}`}>
                    <Select id={`trigger-source-${index}`} value={event.source} onChange={(change) => setEvents(events.map((entry, at) => (at === index ? { ...entry, source: change.target.value } : entry)))}>
                      <option value="">Any source</option>
                      {SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {SOURCE_META[source].label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button size="sm" variant="ghost" aria-label={`Remove event trigger ${index + 1}`} onClick={() => setEvents(events.filter((_, at) => at !== index))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" disabled={events.length >= 10} onClick={() => setEvents([...events, { tag: "", source: "" }])}>
                <Plus aria-hidden />
                Add an event
              </Button>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-ink-2">Webhook</legend>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={webhook} onChange={(event) => setWebhook(event.target.checked)} />
                Accept runs started by POST with a secret
              </label>
              {triggers.webhook && webhook && (
                <div className="space-y-1">
                  <p className="text-xs text-muted">Trigger URL</p>
                  <CopyField value={new URL(triggers.webhook.url, origin).href} />
                </div>
              )}
              {secret && (
                <div role="status" className="space-y-1">
                  <p className="text-xs font-semibold text-wait-ink">The secret, shown once: send it as a Bearer token.</p>
                  <CopyField value={secret.webhookSecret} />
                </div>
              )}
            </fieldset>
            <SubmitButton size="sm" variant="secondary" disabled={Boolean(cronIssue || zoneIssue)}>
              Save triggers
            </SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}
