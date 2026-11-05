import { Bot, Brain, Trash2, User } from "lucide-react";

import { forgetAction } from "@/app/w/[slug]/actions";
import { MEMORY_KIND_META } from "@/lib/domain";
import { timeAgo, truncate } from "@/lib/format";
import type { Memory } from "@/server/domain/memory";

import { EditMemoryPopover } from "./edit-memory-form";
import { GoalLink } from "./goal-link";
import { ActionButton } from "./ui/action-button";
import { Badge, MetaBadge } from "./ui/badge";
import { EmptyState } from "./ui/stat";

interface MemoryListProps {
  memories: readonly Memory[];
  slug: string;
  canWrite: boolean;
  /** Titles for linking each memory to its goal; omit when the list is already under one goal. */
  goalTitles?: ReadonlyMap<string, string>;
  empty?: string;
}

export function MemoryList({ memories, slug, canWrite, goalTitles, empty = "Nothing remembered yet" }: MemoryListProps) {
  if (memories.length === 0) {
    return (
      <EmptyState icon={<Brain />} title={empty}>
        Agents save facts, preferences, and choices here so every agent in the workspace can recall them.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-rule">
      {memories.map((memory) => {
        const goalTitle = memory.goalId ? goalTitles?.get(memory.goalId) : undefined;
        const AuthorIcon = memory.createdByType === "agent" ? Bot : User;
        return (
          <li key={memory.id} className="group/mem flex gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm whitespace-pre-line text-ink">{memory.content}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <MetaBadge meta={MEMORY_KIND_META} value={memory.kind} />
                {memory.tags.map((tag) => (
                  <Badge key={tag}>#{tag}</Badge>
                ))}
                {memory.goalId && goalTitle && <GoalLink slug={slug} goalId={memory.goalId} title={goalTitle} />}
                <span className="inline-flex items-center gap-1">
                  <AuthorIcon className="size-3" aria-hidden />
                  {memory.createdByName}
                </span>
                <span>{timeAgo(memory.updatedAt)}</span>
              </div>
            </div>
            {canWrite && (
              <div className="flex shrink-0 items-start gap-0.5 pointer-fine:opacity-0 pointer-fine:group-hover/mem:opacity-100 pointer-fine:group-focus-within/mem:opacity-100 pointer-fine:has-[details[open]]:opacity-100">
              <EditMemoryPopover memory={memory} slug={slug} />
              <ActionButton
                action={forgetAction}
                workspace={slug}
                fields={{ memoryId: memory.id }}
                confirm="Forget this memory for every agent?"
                notice={`Forgot “${truncate(memory.content, 50)}”`}
                size="sm"
                variant="ghost"
                aria-label={`Forget “${truncate(memory.content, 50)}”`}
              >
                <Trash2 aria-hidden />
              </ActionButton>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
