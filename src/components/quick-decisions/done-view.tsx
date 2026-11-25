"use client";

import { Check, Undo2 } from "lucide-react";
import { useState } from "react";

import type { AnsweredEntry } from "@/lib/quick-decisions";
import { routes } from "@/lib/routes";

import { Button, ButtonLink } from "../ui/button";

/**
 * The end of the queue: a check, a cheerful title the server picked, what was answered in this
 * session (each with Undo where it can still be taken back), and the way back to Decisions.
 */
export function DoneView({ slug, title, answered, onUndo }: { slug: string; title: string; answered: readonly AnsweredEntry[]; onUndo: (entry: AnsweredEntry) => Promise<boolean> }) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <section aria-labelledby="quick-done-title" data-quick-done className="surface mx-auto w-full max-w-xl rounded-lg border border-rule px-5 py-8 text-center">
      <span aria-hidden className="mx-auto flex size-14 items-center justify-center rounded-full bg-arrive-tint text-arrive-ink ring-1 ring-arrive/30 ring-inset">
        <Check className="size-7" strokeWidth={2.5} />
      </span>
      <h2 id="quick-done-title" tabIndex={-1} className="mt-4 text-xl font-bold text-pretty text-ink outline-none">
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-ink-2">{answered.length ? `${answered.length} answered. Each agent has its answer now.` : "Nothing is waiting on you right now."}</p>
      {answered.length > 0 && (
        <ul aria-label="Answered in this session" className="mt-6 divide-y divide-rule border-y border-rule text-left">
          {answered.map((entry) => (
            <li key={entry.requestId} data-answered={entry.requestId} className="flex items-center gap-3 py-3">
              <p className="min-w-0 flex-1 text-sm wrap-anywhere text-ink">{entry.label}</p>
              {entry.undoable && (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={pending === entry.requestId}
                  aria-label={`Undo ${entry.label}`}
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
