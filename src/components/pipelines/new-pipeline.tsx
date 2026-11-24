"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { definePipelineAction } from "@/app/w/[slug]/actions";
import { DEFINABLE_PIPELINE_KINDS, LIMITS, PIPELINE_KIND_META } from "@/lib/domain";
import { PIPELINE_TEMPLATE_META, PIPELINE_TEMPLATES, type PipelineTemplate } from "@/lib/pipeline-templates";
import { pipelineShape } from "@/lib/pipelines";

import { ActionForm } from "../ui/action-form";
import { enumOptions, Field, Input, Select } from "../ui/field";
import { Popover, PopoverCancel } from "../ui/popover";
import { SubmitButton } from "../ui/submit-button";

/**
 * Making a pipeline by hand: a name, its kind and a template to start from, then the editor. Agents
 * define most pipelines over MCP, so this stays a quiet ghost button (the Agents First Rule).
 */
export function NewPipeline({ slug }: { slug: string }) {
  const [template, setTemplate] = useState<PipelineTemplate>("research_send");
  const [kind, setKind] = useState<string>("regular");
  const meta = PIPELINE_TEMPLATE_META[template];
  return (
    <Popover variant="ghost" icon={<Plus aria-hidden />} label={<span className="max-sm:sr-only">New pipeline</span>} triggerLabel="New pipeline" title="New pipeline" className="sm:w-96" triggerClassName="max-sm:px-2">
      <ActionForm
        action={definePipelineAction}
        workspace={slug}
        analytics={{ event: "pipeline_create", params: { kind, template, ...pipelineShape(meta.definition), created_by: "person" } }}
        className="space-y-3"
      >
        <p className="text-xs text-muted">Most pipelines are defined by an agent: describe one to it. Or start from a template and edit it here.</p>
        <input type="hidden" name="definition" value={JSON.stringify(meta.definition)} />
        <Field label="Name" htmlFor="new-pipeline-name">
          <Input id="new-pipeline-name" name="name" required maxLength={LIMITS.title} placeholder="Weekly newsletter" />
        </Field>
        <Field label="Kind" htmlFor="new-pipeline-kind" hint="Regular pipelines repeat; an ad hoc one runs once, starting now.">
          <Select id="new-pipeline-kind" name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
            {enumOptions(DEFINABLE_PIPELINE_KINDS, PIPELINE_KIND_META)}
          </Select>
        </Field>
        <Field label="Start from" htmlFor="new-pipeline-template" hint={meta.hint}>
          <Select id="new-pipeline-template" value={template} onChange={(event) => setTemplate(event.target.value as PipelineTemplate)}>
            {PIPELINE_TEMPLATES.map((key) => (
              <option key={key} value={key}>
                {PIPELINE_TEMPLATE_META[key].label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="primary">
            Create
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}
