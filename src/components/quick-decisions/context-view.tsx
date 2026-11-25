"use client";

import { ChevronLeft, ChevronRight, FileText, PenLine, Send } from "lucide-react";
import Link from "next/link";

import { cx } from "@/lib/cx";
import { DOCUMENT_FORMAT_META } from "@/lib/documents";
import type { ContextTab, QuickItem } from "@/lib/quick-decisions";
import { routes } from "@/lib/routes";

import { TaskLinks } from "../agent-sessions";
import { RecommendedTag } from "../recommended-tag";
import { Button, buttonClasses } from "../ui/button";
import { SEGMENTED, segment } from "../ui/segmented";
import { Composer } from "./composer";
import type { QuickController } from "./controller";

/** The back link at the top of a Quick Decisions screen: one tap to where the person came from. */
export function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <Link href={href} scroll={false} className={buttonClasses("ghost", "sm", "-ml-2 h-11 px-2")}>
      <ChevronLeft aria-hidden />
      {children}
    </Link>
  );
}

/**
 * The answers, held at the bottom of the full context so the person can answer while reading: every
 * option as a capsule, wrapping onto as many rows as they need so none hides behind a scroll (the
 * recommended one filled), or for a request that takes several one Send naming the picks carried
 * over from the card, and Other… for a written answer.
 */
function AnswerDock({ item, ctl }: { item: QuickItem; ctl: QuickController }) {
  const recommended = new Set(item.request.recommended ?? []);
  const { request } = item;
  const other = (
    <Composer
      item={item}
      onSend={(answer) => ctl.answerText(item, answer, "dock")}
      label={request.options.length ? "Other…" : "Answer"}
      icon={<PenLine aria-hidden />}
      variant={request.options.length ? "secondary" : "primary"}
      size="touch"
    />
  );
  return (
    <div
      role="group"
      aria-label="Answer"
      data-answer-dock
      className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mt-6 flex flex-wrap items-center gap-1.5 rounded-3xl p-1.5"
    >
      {/* The glass is a layer of its own, not the dock: a backdrop filter would trap the composer's sheet inside it. */}
      <div aria-hidden className="glass-float absolute inset-0 -z-10 rounded-3xl" />
      {request.options.length === 0 ? (
        <div className="flex-1 [&_summary]:w-full">{other}</div>
      ) : request.multiple ? (
        <>
          <Button variant="primary" size="touch" className="min-w-0 flex-1" disabled={!ctl.picksOf(item).length} onClick={() => ctl.send(item, "dock")}>
            <Send aria-hidden />
            <span className="truncate">{ctl.picksOf(item).length ? (ctl.sendLabel(item) ?? "") : "Pick on the card first"}</span>
          </Button>
          {other}
        </>
      ) : (
        <>
          {request.options.map((option, index) => (
              <Button
                key={option}
                variant={recommended.has(index) ? "primary" : "secondary"}
                size="touch"
                className="max-w-full"
                data-option={index + 1}
                onClick={() => ctl.answerOption(item, index, "dock")}
              >
                <span className="truncate">{option}</span>
                {recommended.has(index) && <RecommendedTag tone="filled" compact />}
              </Button>
            ))}
          {other}
        </>
      )}
    </div>
  );
}

/**
 * A request's full context, as a screen of its own: the question, then tabs for the context as the
 * Decisions page shows it, the task's files and the request's links, over a dock for answering.
 */
export function ContextView({ slug, item, tab, count, ctl }: { slug: string; item: QuickItem; tab: ContextTab; count: string; ctl: QuickController }) {
  const { request } = item;
  const tabs: { id: ContextTab; label: string }[] = [
    { id: "context", label: "Context" },
    { id: "files", label: `Files (${item.documents.length})` },
    { id: "links", label: `Links (${request.links.length})` },
  ];
  return (
    <section aria-labelledby="quick-context-question" data-quick-context={request.id} className="mx-auto flex w-full max-w-xl flex-1 flex-col">
      <div className="flex items-center justify-between gap-3">
        <BackLink href={ctl.href({ request: request.id })}>Decision</BackLink>
        <span className="text-sm font-semibold text-muted tabular-nums">{count}</span>
      </div>
      <p className="mt-3 text-sm text-muted">
        <span className="font-semibold text-ink-2">{item.asker}</span> asks
      </p>
      <h1 id="quick-context-question" className="mt-1 text-xl font-semibold text-pretty wrap-anywhere text-ink">
        {request.question}
      </h1>
      <nav aria-label="Context, files and links" className={cx(SEGMENTED, "mt-4 w-full")}>
        {tabs.map(({ id, label }) => (
          <Link
            key={id}
            href={ctl.href({ request: request.id, view: "context", tab: id === "context" ? undefined : id })}
            scroll={false}
            replace
            aria-current={tab === id ? "page" : undefined}
            className={cx(segment(tab === id), "flex min-h-11 flex-1 items-center justify-center")}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-4 min-h-48 flex-1">
        {tab === "context" && (
          <div className="space-y-4">
            {request.context ? (
              <p className="text-sm whitespace-pre-line wrap-anywhere text-ink">{request.context}</p>
            ) : (
              <p className="text-sm text-muted">{request.agentName} gave no more context than the question.</p>
            )}
            {item.pipeline && item.pipeline.steps.length > 0 && (
              <ul aria-label="What each answer leads to" className="space-y-1 text-xs text-ink-2">
                {item.pipeline.steps.map((step) => (
                  <li key={step.option}>
                    <span className="font-semibold text-ink">{step.option}</span> <span aria-hidden>→</span>
                    <span className="sr-only"> leads to</span> {step.next}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              On the task{" "}
              <Link href={routes.task(slug, item.taskId)} className="inline-flex min-h-11 items-center font-semibold text-ink-2 link">
                {item.title}
              </Link>
            </p>
          </div>
        )}
        {tab === "files" &&
          (item.documents.length ? (
            <ul aria-label="Files" className="divide-y divide-rule rounded-lg border border-rule surface">
              {item.documents.map((document) => (
                <li key={document.id}>
                  <Link
                    href={ctl.href({ request: request.id, view: "file", file: document.id })}
                    scroll={false}
                    data-document={document.id}
                    className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm hover:bg-fill"
                  >
                    <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink">{document.title}</span>
                    <span className="text-xs text-muted">{DOCUMENT_FORMAT_META[document.format].label}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No files on this request&apos;s task.</p>
          ))}
        {tab === "links" && (request.links.length ? <TaskLinks links={request.links} size="touch" /> : <p className="text-sm text-muted">No links on this request.</p>)}
      </div>
      <AnswerDock item={item} ctl={ctl} />
    </section>
  );
}
