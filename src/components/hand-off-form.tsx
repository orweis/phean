import { Handshake } from "lucide-react";

import { handOffTaskAction } from "@/app/w/[slug]/actions";
import { LIMITS } from "@/lib/domain";
import type { TaskView } from "@/server/domain/tasks";

import { ActionForm } from "./ui/action-form";
import { Field, Select, Textarea } from "./ui/field";
import { Popover, PopoverCancel } from "./ui/popover";
import { SubmitButton } from "./ui/submit-button";

/** Who a task can be handed to: the workspace's live agents and its people, by id and name. */
export interface HandOffTargets {
  agents: readonly { id: string; name: string }[];
  people: readonly { userId: string; name: string }[];
}

/**
 * Hands a task on: to an agent, to a person, or to anyone, with a note for whoever picks it up. The
 * task stays with its operator until then, so nothing is dropped between the two.
 */
export function HandOffPopover({ task, slug, targets }: { task: TaskView; slug: string; targets: HandOffTargets }) {
  const id = (field: string) => `hand-off-${task.id}-${field}`;
  const agents = targets.agents.filter((agent) => agent.id !== task.claimedByAgentId);
  const people = targets.people.filter((person) => person.userId !== task.operatorUserId);
  return (
    <Popover label="Hand off" icon={<Handshake aria-hidden />} look="link" align="left" title="Hand off this task" triggerLabel={`Hand off ${task.title}`}>
      <ActionForm action={handOffTaskAction} workspace={slug} className="space-y-3" notice={`Handing off “${task.title}”`} closeOnSuccess>
        <input type="hidden" name="taskId" value={task.id} />
        <p className="text-xs text-ink-2">
          {task.operatorName
            ? `It stays with ${task.operatorName} until someone picks it up.`
            : "Whoever picks it up becomes its operator."}
        </p>
        <Field label="To" htmlFor={id("to")}>
          <Select id={id("to")} name="to" defaultValue={task.delegateToAgentId ? `agent:${task.delegateToAgentId}` : task.delegateToUserId ? `person:${task.delegateToUserId}` : ""}>
            <option value="">Anyone: the first agent or person to pick it up</option>
            {agents.length > 0 && (
              <optgroup label="Agents">
                {agents.map((agent) => (
                  <option key={agent.id} value={`agent:${agent.id}`}>
                    {agent.name}
                  </option>
                ))}
              </optgroup>
            )}
            {people.length > 0 && (
              <optgroup label="People">
                {people.map((person) => (
                  <option key={person.userId} value={`person:${person.userId}`}>
                    {person.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field label="Handoff note" htmlFor={id("note")} hint="Where it stands, what is left, and what they must not miss.">
          <Textarea id={id("note")} name="note" maxLength={LIMITS.note} defaultValue={task.delegation === "handing_off" ? task.delegationNote : ""} />
        </Field>
        <div className="flex items-center gap-2">
          <SubmitButton size="sm" variant="primary">
            Hand off
          </SubmitButton>
          <PopoverCancel />
        </div>
      </ActionForm>
    </Popover>
  );
}
