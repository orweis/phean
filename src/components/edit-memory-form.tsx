import { Pencil } from "lucide-react";

import { updateMemoryAction } from "@/app/w/[slug]/actions";
import { LIMITS, MEMORY_KIND_META, MEMORY_KINDS } from "@/lib/domain";
import { truncate } from "@/lib/format";
import type { Memory } from "@/server/domain/memory";

import { ActionForm } from "./ui/action-form";
import { enumOptions, Field, Input, Select, Textarea } from "./ui/field";
import { Popover, PopoverCancel } from "./ui/popover";
import { SubmitButton } from "./ui/submit-button";

/** Fixes a memory in place: its words, its kind, its tags. Every agent recalls the corrected version. */
export function EditMemoryPopover({ memory, slug }: { memory: Memory; slug: string }) {
  const id = (field: string) => `memory-${memory.id}-${field}`;
  return (
    <Popover
      variant="ghost"
      label={<Pencil aria-hidden />}
      triggerLabel={`Edit “${truncate(memory.content, 50)}”`}
      triggerClassName="px-2"
      title="Edit memory"
    >
      <ActionForm action={updateMemoryAction} workspace={slug} className="space-y-3" notice="Saved the memory" closeOnSuccess>
        <input type="hidden" name="memoryId" value={memory.id} />
        <Field label="What agents remember" htmlFor={id("content")}>
          <Textarea id={id("content")} name="content" required maxLength={LIMITS.memory} defaultValue={memory.content} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kind" htmlFor={id("kind")}>
            <Select id={id("kind")} name="kind" defaultValue={memory.kind}>
              {enumOptions(MEMORY_KINDS, MEMORY_KIND_META)}
            </Select>
          </Field>
          <Field label="Tags" htmlFor={id("tags")} hint="Comma-separated">
            <Input id={id("tags")} name="tags" defaultValue={memory.tags.join(", ")} />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="primary">
            Save
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}
