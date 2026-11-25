"use client";

import { Check, Undo2 } from "lucide-react";
import { useState } from "react";

import { routes } from "@/lib/routes";

import { Button, ButtonLink } from "../ui/button";

/** An answer given in this session, kept so the done screen can list it and take it back. */
export interface Answered {
  requestId: string;
  taskId: string;
  question: string;
  answer: string;
  agentName: string;
  /** A pipeline acts on its answer at once, so it cannot be taken back. */
  undoable: boolean;
}

/**
 * The end of the queue: a check, a cheerful title the server picked, what was answered in this
 * session (each with Undo where it can still be taken back), and the way back to Decisions.
 */
export function DoneView({ slug, title, answered, onUndo }: { slug: string; title: string; answered: readonly Answered[]; onUndo: (entry: Answered) => Promise<boolean> }) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <section aria-labelledby="quick-done-title" data-quick-done className="surface mx-auto max-w-xl rounded-lg border border-rule px-5 py-8 text-center">
      <span aria-hidden className="mx-auto flex size-14 items-center justify-center rounded-full bg-arrive-tint text-arrive-ink ring-1 ring-arrive/30 ring-inset">
        <Check className="size-7" strokeWidth={2.5} />
      </span>
      <h2 id="quick-done-title" tabIndex={-1} className="mt-4 text-xl font-bold text-pretty text-ink outline-none">
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-ink-2">
        {answered.length ? `${answered.length} answered. Each agent has its answer now.` : "Nothing is waiting on you right now."}
      </p>
      {answered.length > 0 && (
        <ul aria-label="Answered in this session" className="mt-6 divide-y divide-rule border-y border-rule text-left">
          {answered.map((entry) => (
            <li key={entry.requestId} data-answered={entry.requestId} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold wrap-anywhere text-ink">{entry.question}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  “{entry.answer}” to {entry.agentName}
                </p>
              </div>
              {entry.undoable && (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={pending === entry.requestId}
                  aria-label={`Undo the answer to ${entry.question}`}
                  onClick={async () => {
                    setPending(entry.requestId);
                    await onUndo(entry);
                    setPending(null);
                  }}
                >
                  {pending !== entry.requestId && <Undo2 aria-hidden />}
                  Undo
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ButtonLink href={routes.decisions(slug)} variant="secondary" size="touch" className="mt-6">
        Back to Decisions
      </ButtonLink>
    </section>
  );
}
