"use client";

import { ChevronRight, FileText, PenLine, Send, Timer, Workflow } from "lucide-react";
import Link from "next/link";

import { REQUEST_KIND_META } from "@/lib/domain";
import { cx } from "@/lib/cx";
import { type QuickItem } from "@/lib/quick-decisions";

import { RecommendedTag } from "../recommended-tag";
import { MetaBadge } from "../ui/badge";
import { Button, buttonClasses } from "../ui/button";
import { Composer } from "./composer";
import type { QuickController } from "./controller";

/** The agent's initial on a squared tile: agents are tiles, people discs, both neutral. */
function AgentTile({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-fill text-sm font-bold text-ink-2 ring-1 ring-rule ring-inset">
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

/** Who asked, where from and when, and whether it is a decision or a question. */
export function AskerRow({ item }: { item: QuickItem }) {
  return (
    <div className="flex items-center gap-3">
      <AgentTile name={item.request.agentName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">{item.asker}</p>
        <p className="truncate text-xs text-muted">
          {item.where && (
            <>
              {item.where}
              <span aria-hidden> · </span>
            </>
          )}
          asked {item.age}
        </p>
      </div>
      <MetaBadge meta={REQUEST_KIND_META} value={item.request.kind} />
    </div>
  );
}

/** The documents on the request's task, as a sideways rail of chips that open the file viewer. */
function Attachments({ item, ctl }: { item: QuickItem; ctl: QuickController }) {
  if (!item.documents.length) return null;
  return (
    <ul aria-label="Files" className="chip-rail -mx-5 mt-4 flex gap-2 px-5 pb-1">
      {item.documents.map((document) => (
        <li key={document.id} className="shrink-0">
          <Link
            href={ctl.href({ request: item.request.id, view: "file", file: document.id })}
            scroll={false}
            data-document={document.id}
            className="inline-flex h-11 max-w-56 items-center gap-1.5 rounded-full bg-fill px-3.5 text-xs font-semibold text-ink-2 hover:bg-rule hover:text-ink"
          >
            <FileText className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{document.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The options of a single-choice request: one tap answers. The recommended one is filled and says so. */
function SingleChoice({ item, ctl }: { item: QuickItem; ctl: QuickController }) {
  const recommended = new Set(item.request.recommended ?? []);
  return (
    <div role="group" aria-label="Answers" className="space-y-2">
      {item.request.options.map((option, index) => (
        <Button
          key={option}
          variant={recommended.has(index) ? "primary" : "ghost"}
          size="answer"
          className={recommended.has(index) ? undefined : "border border-edge"}
          data-option={index + 1}
          aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
          onClick={() => ctl.answerOption(item, index, "tap")}
        >
          {option}
          {recommended.has(index) && <RecommendedTag tone="filled" />}
        </Button>
      ))}
    </div>
  );
}

/** A request that takes several answers: tick rows (the agent's suggestions start ticked), then one Send naming the picks. */
function Picks({ item, ctl }: { item: QuickItem; ctl: QuickController }) {
  const picks = ctl.picksOf(item);
  const suggested = new Set(item.request.recommended ?? []);
  const label = ctl.sendLabel(item);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (picks.length) ctl.send(item, "tap");
      }}
      className="space-y-2"
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs text-muted">Pick any that apply</legend>
        {item.request.options.map((option, index) => (
          <label
            key={option}
            className={cx(
              "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-edge px-4 py-2 text-sm font-semibold text-ink select-none",
              "has-checked:border-accent has-checked:bg-accent-tint has-checked:text-accent-ink has-checked:ring-1 has-checked:ring-accent has-checked:ring-inset",
              "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
            )}
          >
            <input
              type="checkbox"
              checked={picks.includes(index)}
              onChange={() => ctl.togglePick(item, index)}
              data-option={index + 1}
              aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
              className="size-5 shrink-0 accent-accent"
            />
            <span className="min-w-0 flex-1 text-pretty wrap-anywhere">{option}</span>
            {suggested.has(index) && <RecommendedTag label="Suggested" tone="quiet" />}
          </label>
        ))}
      </fieldset>
      <Button type="submit" variant="primary" size="answer" disabled={!picks.length}>
        <Send aria-hidden />
        {label ?? "Pick at least one"}
      </Button>
    </form>
  );
}

/**
 * One request as a card: who asked, the pipeline it holds up, the question, the start of the
 * context, its files and its time limit, then the answers at the bottom where a thumb reaches.
 */
export function QuickCard({ item, ctl }: { item: QuickItem; ctl: QuickController }) {
  const { request } = item;
  const hasMore = Boolean(request.context || item.documents.length || request.links.length || item.pipeline?.steps.length);
  return (
    <>
      <div className="p-5 pb-0">
        <AskerRow item={item} />
        {item.pipeline && (
          <p data-pipeline-line className="mt-3 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold text-ink-2">
            <Workflow className="size-3.5 shrink-0" aria-hidden />
            <span>{item.pipeline.label}</span>
            {item.pipeline.position && (
              <>
                <span aria-hidden>·</span>
                <span>{item.pipeline.position}</span>
              </>
            )}
          </p>
        )}
        <h2 id={ctl.questionId(item)} tabIndex={-1} className="mt-4 text-xl font-semibold text-pretty wrap-anywhere text-ink outline-none focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus">
          {request.question}
        </h2>
        {request.context && <p className="mt-3 line-clamp-3 text-sm whitespace-pre-line wrap-anywhere text-ink-2">{request.context}</p>}
        {hasMore && (
          <Link
            href={ctl.href({ request: request.id, view: "context" })}
            scroll={false}
            className={buttonClasses("ghost", "sm", "-ml-3 mt-1 text-accent-ink")}
          >
            Read full context
            <ChevronRight aria-hidden />
          </Link>
        )}
        <Attachments item={item} ctl={ctl} />
        {item.pipeline?.timeLimit && (
          <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-wait-ink">
            <Timer className="size-3.5 shrink-0" aria-hidden />
            {item.pipeline.timeLimit}
          </p>
        )}
      </div>
      <div className="mt-auto space-y-2 p-5 pt-6">
        {request.options.length === 0 ? (
          <Composer item={item} onSend={(answer) => ctl.answerText(item, answer, "composer")} label="Answer" icon={<PenLine aria-hidden />} variant="primary" size="answer" />
        ) : (
          <>
            {request.multiple ? <Picks item={item} ctl={ctl} /> : <SingleChoice item={item} ctl={ctl} />}
            <Composer
              item={item}
              onSend={(answer) => ctl.answerText(item, answer, "composer")}
              label="Write another answer"
              icon={<PenLine aria-hidden />}
              size="answer"
              triggerClassName="border border-dashed border-edge"
            />
          </>
        )}
      </div>
    </>
  );
}
