"use client";

import { Play } from "lucide-react";
import { useState } from "react";

import { startRunAction } from "@/app/w/[slug]/actions";
import { LIMITS } from "@/lib/domain";
import type { PipelineInputSpec } from "@/lib/pipelines";
import type { Tracked } from "@/lib/tracked";

import { ActionForm } from "../ui/action-form";
import { Field, Input } from "../ui/field";
import { Popover, PopoverCancel } from "../ui/popover";
import { SubmitButton } from "../ui/submit-button";

/**
 * Starts a run of a pipeline: a panel asks for its name (what this run makes) and its inputs, which
 * go to the service as one JSON field.
 */
const STARTED: Tracked = { event: "run_start", params: { trigger: "manual" } };

export function StartRun({ slug, pipelineId, name, inputs, variant = "tinted" }: { slug: string; pipelineId: string; name: string; inputs: readonly PipelineInputSpec[]; variant?: "tinted" | "primary" }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const filled = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
  return (
    <Popover variant={variant === "primary" ? "primary" : "tinted"} icon={<Play aria-hidden />} label="Start run" triggerLabel={`Start run of ${name}`} title={`Start ${name}`} className="sm:w-80">
      <ActionForm action={startRunAction} workspace={slug} analytics={STARTED} className="space-y-3">
        <input type="hidden" name="pipelineId" value={pipelineId} />
        <input type="hidden" name="inputs" value={JSON.stringify(filled)} />
        <Field label="Name" htmlFor={`run-${pipelineId}-name`} hint="What this run makes, so people know it at a glance. Optional.">
          <Input id={`run-${pipelineId}-name`} name="name" maxLength={LIMITS.runName} placeholder="Issue 42: AI agents roundup" />
        </Field>
        {inputs.map((input) => (
          <Field key={input.name} label={input.required ? `${input.name} (required)` : input.name} htmlFor={`run-${pipelineId}-${input.name}`} hint={input.description || undefined}>
            <Input
              id={`run-${pipelineId}-${input.name}`}
              required={input.required}
              value={values[input.name] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [input.name]: event.target.value }))}
            />
          </Field>
        ))}
        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="primary">
            Start run
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}
