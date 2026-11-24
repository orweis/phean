"use client";

import { Play } from "lucide-react";
import { useState } from "react";

import { startRunAction } from "@/app/w/[slug]/actions";
import type { PipelineInputSpec } from "@/lib/pipelines";
import type { Tracked } from "@/lib/tracked";

import { ActionButton } from "../ui/action-button";
import { ActionForm } from "../ui/action-form";
import { Field, Input } from "../ui/field";
import { Popover, PopoverCancel } from "../ui/popover";
import { SubmitButton } from "../ui/submit-button";

/**
 * Starts a run of a pipeline. With no inputs to give it is one click; otherwise a panel asks for the
 * inputs, which go to the service as one JSON field.
 */
const STARTED: Tracked = { event: "run_start", params: { trigger: "manual" } };

export function StartRun({ slug, pipelineId, name, inputs, variant = "tinted" }: { slug: string; pipelineId: string; name: string; inputs: readonly PipelineInputSpec[]; variant?: "tinted" | "primary" }) {
  const [values, setValues] = useState<Record<string, string>>({});
  if (inputs.length === 0) {
    return (
      <ActionButton action={startRunAction} workspace={slug} fields={{ pipelineId }} analytics={STARTED} size="sm" variant={variant} aria-label={`Start run of ${name}`}>
        <Play aria-hidden />
        Start run
      </ActionButton>
    );
  }
  const filled = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));
  return (
    <Popover variant={variant === "primary" ? "primary" : "tinted"} icon={<Play aria-hidden />} label="Start run" triggerLabel={`Start run of ${name}`} title={`Start ${name}`} className="sm:w-80">
      <ActionForm action={startRunAction} workspace={slug} analytics={STARTED} className="space-y-3">
        <input type="hidden" name="pipelineId" value={pipelineId} />
        <input type="hidden" name="inputs" value={JSON.stringify(filled)} />
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
