import { Bot, Brain, Target, Trash2, User } from "lucide-react";
import Link from "next/link";

import { forgetAction } from "@/app/w/[slug]/actions";
import { MEMORY_KIND_META } from "@/lib/domain";
import { timeAgo } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { Memory } from "@/server/domain/memory";

import { ActionForm } from "./ui/action-form";
import { Badge, MetaBadge } from "./ui/badge";
import { EmptyState } from "./ui/stat";
import { SubmitButton } from "./ui/submit-button";

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
        Agents save facts, preferences, and decisions here so every agent in the workspace can recall them.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-rule">
      {memories.map((memory) => {
        const goalTitle = memory.goalId ? goalTitles?.get(memory.goalId) : undefined;
        const AuthorIcon = memory.createdByType === "agent" ? Bot : User;
        return (
          <li key={memory.id} className="flex gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm whitespace-pre-line text-ink">{memory.content}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <MetaBadge meta={MEMORY_KIND_META} value={memory.kind} />
                {memory.tags.map((tag) => (
                  <Badge key={tag}>#{tag}</Badge>
                ))}
                {memory.goalId && goalTitle && (
                  <Link href={routes.goal(slug, memory.goalId)} className="inline-flex max-w-56 items-center gap-1 hover:text-ink link">
                    <Target className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{goalTitle}</span>
                  </Link>
                )}
                <span className="inline-flex items-center gap-1">
                  <AuthorIcon className="size-3" aria-hidden />
                  {memory.createdByName}
                </span>
                <span>{timeAgo(memory.updatedAt)}</span>
              </div>
            </div>
            {canWrite && (
              <ActionForm action={forgetAction} workspace={slug} confirm="Forget this memory for every agent?" quiet>
                <input type="hidden" name="memoryId" value={memory.id} />
                <SubmitButton size="sm" variant="ghost" aria-label="Forget">
                  <Trash2 aria-hidden />
                </SubmitButton>
              </ActionForm>
            )}
          </li>
        );
      })}
    </ul>
  );
}
