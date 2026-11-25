"use client";

import { AlarmClock, Check, ChevronRight, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { approvalsLine, snoozedTitle, type AnsweredEntry } from "@/lib/quick-decisions";
import { routes } from "@/lib/routes";

import { Button, ButtonLink } from "../ui/button";

/** The goals still waiting for approval, which the queue does not hold, as a link to them. */
function ApprovalsLink({ slug, count }: { slug: string; count: number }) {
  const line = approvalsLine(count);
  if (!line) return null;
  return (
    <Link href={routes.approvals(slug)} data-quick-approvals className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-ink link">
      {line}
      <ChevronRight className="size-4" aria-hidden />
    </Link>
  );
}

/**
 * The queue has come round to what was snoozed in this visit, and nothing else waits: it rests
 * here rather than showing the same card again, with a way to see the snoozed ones once more.
 */
export function SnoozedView({ slug, snoozed, approvals, onShow }: { slug: string; snoozed: number; approvals: number; onShow: () => void }) {
  return (
    <section aria-labelledby="quick-done-title" data-quick-snoozed className="surface mx-auto mb-20 w-full max-w-xl rounded-lg border border-rule px-5 py-8 text-center">
      <span aria-hidden className="mx-auto flex size-14 items-center justify-center rounded-full bg-wait-tint text-wait-ink ring-1 ring-wait/30 ring-inset">
        <AlarmClock className="size-7" strokeWidth={2.25} />
      </span>
      <h2 id="quick-done-title" tabIndex={-1} className="mt-4 text-xl font-bold text-pretty text-ink outline-none">
        {snoozedTitle(snoozed)}
      </h2>
      <p className="mt-1.5 text-sm text-ink-2">They wait at the back of the queue until you come back to them.</p>
      <div>
        <ApprovalsLink slug={slug} count={approvals} />
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <ButtonLink href={routes.decisions(slug)} variant="secondary" size="touch">
          Back to Decisions
        </ButtonLink>
        <Button variant="primary" size="touch" onClick={onShow}>
          <AlarmClock aria-hidden />
          Show snoozed again
        </Button>
      </div>
    </section>
  );
}

/**
 * The end of the queue: a check, a cheerful title the server picked, what was answered in this
 * session (each with Undo where it can still be taken back), and the way back to Decisions.
 */
export function DoneView({
  slug,
  title,
  answered,
  approvals,
  onUndo,
}: {
  slug: string;
  title: string;
  answered: readonly AnsweredEntry[];
  approvals: number;
  onUndo: (entry: AnsweredEntry) => Promise<boolean>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <section aria-labelledby="quick-done-title" data-quick-done className="surface mx-auto mb-20 w-full max-w-xl rounded-lg border border-rule px-5 py-8 text-center">
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
      <div>
        <ApprovalsLink slug={slug} count={approvals} />
      </div>
      <ButtonLink href={routes.decisions(slug)} variant="secondary" size="touch" className="mt-6">
        Back to Decisions
      </ButtonLink>
    </section>
  );
}
