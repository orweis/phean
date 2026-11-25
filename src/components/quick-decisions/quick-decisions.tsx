"use client";

import { AlarmClock, BookOpen, Check, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { answerInputAction, retractAnswerAction, snoozeRequestAction } from "@/app/w/[slug]/actions";
import { IDLE } from "@/lib/action-state";
import { countBucket, track } from "@/lib/analytics";
import { cx } from "@/lib/cx";
import { truncate } from "@/lib/format";
import {
  answeredEntry,
  answerReceipt,
  ARRIVAL_GUARD_MS,
  isStaleRefusal,
  mayAct,
  picksLabel,
  progressSegments,
  progressText,
  quickOrder,
  type AnsweredEntry,
  type ContextTab,
  type QuickEntry,
  type QuickItem,
} from "@/lib/quick-decisions";
import { routes } from "@/lib/routes";
import { sendTracked } from "@/lib/tracked";

import { trackShortcut } from "../keyboard-shortcuts";
import { Button, ButtonLink, buttonClasses } from "../ui/button";
import { useStatus, type UndoSpec } from "../ui/status-region";
import { ContextView } from "./context-view";
import type { AnswerGesture, QuickController, SnoozeGesture } from "./controller";
import { DoneView } from "./done-view";
import { FileView, type QuickFile } from "./file-view";
import { QuickCard } from "./quick-card";
import { SwipeCard } from "./swipe-card";
import { answeredNow, useAnswered } from "./use-answered";

export type { QuickFile } from "./file-view";

/** Typing into a field never answers anything; a tick box is not typing. */
const TYPING = "input:not([type=checkbox]), textarea, select, [contenteditable]";

const without = <T,>(set: ReadonlySet<T>, value: T) => {
  const next = new Set(set);
  next.delete(value);
  return next;
};

const omit = (record: Readonly<Record<string, string>>, key: string) => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

const questionIdOf = (item: QuickItem) => `quick-q-${item.request.id}`;

/** The option an agent recommends on a single-choice request, by its words. */
function recommendedOption(item: QuickItem): string | undefined {
  const recommended = item.request.recommended?.[0];
  return recommended === undefined ? undefined : item.request.options[recommended];
}

/** What a swipe right sends, given the picks on a request that takes several: “Okafor LLP”, Blog + Changelog; null when there is nothing to send. */
function sendTargetOf(item: QuickItem, picks: readonly number[]): string | null {
  if (item.request.multiple) return picks.length ? picksLabel(item.request.options, picks) : null;
  const option = recommendedOption(item);
  return option === undefined ? null : `“${truncate(option, 40)}”`;
}

/** What a swipe right sends, in words: "Send “Okafor LLP”", "Send Blog + Changelog"; null when there is nothing to send. */
function sendLabelOf(item: QuickItem, picks: readonly number[]): string | null {
  const target = sendTargetOf(item, picks);
  return target === null ? null : `Send ${target}`;
}

/**
 * Quick Decisions' own slim bar, in place of the workspace's header: the way out, the title, where
 * the person is in the queue, and the progress bar with its words.
 */
function QueueHeader({ slug, answered, remaining, onClose }: { slug: string; answered: number; remaining: number; onClose: () => void }) {
  const total = answered + remaining;
  const { count, spoken } = progressText(answered, remaining);
  return (
    <header data-quick-header className="mb-3 shrink-0">
      <div className="-ml-2 flex items-center gap-1">
        <Link href={routes.decisions(slug)} onClick={onClose} aria-label="Close Quick Decisions" className={cx(buttonClasses("ghost", "touch"), "shrink-0")}>
          <X aria-hidden />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-md font-semibold text-ink">Quick Decisions</h1>
        {total > 0 && (
          <span data-progress-count aria-hidden className="shrink-0 text-sm font-semibold text-ink-2 tabular-nums">
            {count}
          </span>
        )}
      </div>
      {total > 0 && (
        <div role="img" aria-label={spoken} data-progress className="mt-2 flex items-center gap-1">
          {progressSegments(answered, remaining).map((state, index) => (
            <span
              key={index}
              data-segment={state}
              className={cx("min-w-1 flex-1 rounded-full", state === "done" ? "h-1.5 bg-accent" : state === "current" ? "h-2 bg-signal" : "h-1.5 bg-rule")}
            />
          ))}
        </div>
      )}
    </header>
  );
}

interface QuickDecisionsProps {
  slug: string;
  /** The person viewing, so what this tab remembers is theirs alone. */
  userId: string;
  /** The open requests, in the Decisions page's order. */
  items: QuickItem[];
  view: "card" | "context" | "file";
  /** The request the URL names, if any; otherwise the first in the queue is on screen. */
  requestId: string | null;
  tab: ContextTab;
  file: QuickFile | null;
  entry: QuickEntry;
  /** Picked at random on the server; kept for the visit, so it does not change under the person. */
  doneTitle: string;
}

/**
 * Quick Decisions: the queue one card at a time. Answers, snoozes and their Undo go through the
 * Decisions page's actions; the card leaves at once and comes back if the server refuses. The
 * request on screen and its view live in the URL, so Back steps through them.
 */
export function QuickDecisions({ slug, userId, items, view, requestId, tab, file, entry, doneTitle }: QuickDecisionsProps) {
  const router = useRouter();
  const status = useStatus();
  const [, startTransition] = useTransition();
  const [title] = useState(doneTitle);
  /** Snoozes made here that the server has not echoed yet, so the card goes to the back at once. */
  const [snoozed, setSnoozed] = useState<Record<string, string>>({});
  /** Requests answered here, hidden while the server catches up (and shown again if it refuses). */
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  /** Ticks on requests that take several, by request; untouched ones start from the agent's suggestions. */
  const [picks, setPicks] = useState<Record<string, number[]>>({});
  const [answered, remember] = useAnswered(userId, slug);
  /** An answer or snooze just moved the queue on, so focus goes to the card that replaced it. */
  const acted = useRef(false);
  /** Requests with an answer or snooze on its way to the server: a second tap or key for one posts nothing. */
  const inFlight = useRef(new Set<string>());
  /** Requests the server took an answer for here, so a later refusal (a second post) never brings the card back. */
  const answeredHere = useRef(new Set<string>());
  /** A card the server would not take, whose question gets focus back once it is on screen again. */
  const [refocus, setRefocus] = useState<string | null>(null);

  const queue = useMemo(() => quickOrder(items.filter((item) => !settled.has(item.request.id)), snoozed), [items, settled, snoozed]);
  const chosen = requestId ? queue.find((item) => item.request.id === requestId) : undefined;
  const current = chosen ?? queue[0];
  const behind = queue.find((item) => item !== current);
  // A view of one request needs that request still waiting (without a named one, the first in the queue); otherwise the card.
  const viewable = requestId ? Boolean(chosen) : Boolean(current);
  const shown: "card" | "context" | "file" = viewable ? (view === "file" && file ? "file" : view === "context" ? "context" : "card") : "card";
  const { count } = progressText(answered.length, queue.length);

  // A card that has just arrived takes no input for a moment (`inert`, and the keys wait): a double
  // tap or a held key meant for the one that left must not answer it, a pipeline's above all.
  const currentId = current?.request.id ?? null;
  const [restingId, setRestingId] = useState<string | null>(null);
  useEffect(() => {
    if (!currentId) return;
    const timer = setTimeout(() => setRestingId(currentId), ARRIVAL_GUARD_MS);
    return () => clearTimeout(timer);
  }, [currentId]);
  const arriving = currentId !== null && restingId !== currentId;
  /** Whether input for `item` counts now: it is not mid-post or settled, and it is not a card that just arrived. */
  const ready = (item: QuickItem) => mayAct(item.request.id, { inFlight: inFlight.current, settled }) && !(arriving && item.request.id === currentId);

  const href = useCallback((query?: Parameters<typeof routes.quickDecisions>[1]) => routes.quickDecisions(slug, query), [slug]);

  /** Back to the queue's own address, once the request a URL named has been answered or snoozed. */
  const toQueue = () => {
    if (requestId || view !== "card") router.replace(href(), { scroll: false });
  };

  const formOf = (item: QuickItem, extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("workspace", slug);
    form.set("taskId", item.taskId);
    form.set("requestId", item.request.id);
    for (const [name, value] of Object.entries(extra)) form.set(name, value);
    return form;
  };

  const restore = (requestIdToRestore: string) => {
    acted.current = true;
    answeredHere.current.delete(requestIdToRestore);
    setSettled((previous) => without(previous, requestIdToRestore));
    remember((list) => list.filter((entry) => entry.requestId !== requestIdToRestore));
    // The server has the request open again; read it, so a reload's list and this one agree.
    router.refresh();
  };

  /** A request the server says is no longer there to act on: it leaves the queue with a word, and the page reads the server again. */
  const dropStale = (item: QuickItem, message: string) => {
    acted.current = true;
    setSettled((previous) => new Set(previous).add(item.request.id));
    status?.announce({ message });
    router.refresh();
  };

  /** Taking an answer back (Undo), which reopens the request: only before its agent collects it, and never a pipeline's. */
  const undoFor = (item: QuickItem): UndoSpec | undefined =>
    item.request.pipeline
      ? undefined
      : {
          action: async (state, form) => {
            const result = await retractAnswerAction(state, form);
            if (result.status !== "error") restore(item.request.id);
            return result;
          },
          fields: { taskId: item.taskId, requestId: item.request.id },
          done: `${item.request.agentName}'s question is open again.`,
          analytics: { event: "decision_undo" },
        };

  const submit = (item: QuickItem, fields: { answer?: string; choices?: number[] }, receipt: string, gesture: AnswerGesture, custom: boolean) => {
    const { request } = item;
    if (!ready(item)) return;
    inFlight.current.add(request.id);
    acted.current = true;
    setSettled((previous) => new Set(previous).add(request.id));
    toQueue();
    startTransition(async () => {
      const form = formOf(item, fields.answer ? { answer: fields.answer } : {});
      for (const choice of fields.choices ?? []) form.append("choices", String(choice));
      const result = await answerInputAction(IDLE, form).finally(() => inFlight.current.delete(request.id));
      if (result.status === "error") {
        if (answeredHere.current.has(request.id)) return;
        if (isStaleRefusal(result.code)) {
          dropStale(item, `Already answered elsewhere: “${truncate(request.question, 60)}”`);
          return;
        }
        setSettled((previous) => without(previous, request.id));
        setRefocus(request.id);
        status?.announce({ message: result.message ?? "Could not send that answer.", tone: "error" });
        return;
      }
      answeredHere.current.add(request.id);
      const server = result.data?.analytics as { first_answer?: boolean } | undefined;
      sendTracked({
        event: "decision_answer",
        params: {
          via: "quick",
          gesture,
          kind: request.kind,
          with_options: request.options.length > 0,
          multiple: Boolean(request.multiple),
          custom_answer: custom,
          is_pipeline: Boolean(request.pipeline),
          first_answer: server?.first_answer === true,
        },
      });
      remember((list) => [...list.filter((entry) => entry.requestId !== request.id), answeredEntry(item, receipt)]);
      status?.announce({ message: answerReceipt(receipt, request), undo: undoFor(item), workspace: slug });
    });
  };

  const picksOf = (item: QuickItem) => picks[item.request.id] ?? (item.request.multiple ? (item.request.recommended ?? []) : []);

  const ctl: QuickController = {
    href,
    questionId: questionIdOf,
    picksOf,
    togglePick: (item, index) =>
      setPicks((previous) => {
        const now = previous[item.request.id] ?? (item.request.recommended ?? []);
        const next = now.includes(index) ? now.filter((pick) => pick !== index) : [...now, index].sort((a, b) => a - b);
        return { ...previous, [item.request.id]: next };
      }),
    sendLabel: (item) => sendLabelOf(item, picksOf(item)),
    send: (item, gesture) => {
      if (item.request.multiple) {
        const chosen = picksOf(item);
        if (!chosen.length) return;
        submit(item, { choices: chosen }, picksLabel(item.request.options, chosen, Infinity), gesture, false);
        return;
      }
      const recommended = item.request.recommended?.[0];
      if (recommended !== undefined) ctl.answerOption(item, recommended, gesture);
    },
    answerOption: (item, index, gesture) => {
      const option = item.request.options[index];
      if (option !== undefined) submit(item, { answer: option }, option, gesture, false);
    },
    answerText: (item, answer, gesture) => submit(item, { answer }, answer, gesture, true),
    snooze: (item: QuickItem, gesture: SnoozeGesture) => {
      const id = item.request.id;
      if (!ready(item)) return;
      inFlight.current.add(id);
      acted.current = true;
      setSnoozed((previous) => ({ ...previous, [id]: new Date().toISOString() }));
      toQueue();
      startTransition(async () => {
        const result = await snoozeRequestAction(IDLE, formOf(item)).finally(() => inFlight.current.delete(id));
        if (result.status === "error") {
          setSnoozed((previous) => omit(previous, id));
          if (isStaleRefusal(result.code)) {
            dropStale(item, `No longer waiting: “${truncate(item.request.question, 60)}”`);
            return;
          }
          setRefocus(id);
          status?.announce({ message: result.message ?? "Could not snooze that.", tone: "error" });
          return;
        }
        sendTracked({ event: "decision_snooze", params: { gesture } });
        const name = truncate(item.title, 60);
        status?.announce({
          message: `Snoozed “${name}” to the back of the queue`,
          workspace: slug,
          undo: {
            action: async (state, form) => {
              const undone = await snoozeRequestAction(state, form);
              if (undone.status !== "error") {
                setSnoozed((previous) => omit(previous, id));
                router.refresh();
              }
              return undone;
            },
            fields: { taskId: item.taskId, requestId: id, undo: "true" },
            done: `“${name}” is back in its place.`,
          },
        });
      });
    },
  };

  const undoFromList = async (entry: AnsweredEntry): Promise<boolean> => {
    const form = new FormData();
    form.set("workspace", slug);
    form.set("taskId", entry.taskId);
    form.set("requestId", entry.requestId);
    const result = await retractAnswerAction(IDLE, form);
    if (result.status === "error") {
      status?.announce({ message: result.message ?? "Could not take that answer back.", tone: "error" });
      return false;
    }
    sendTracked({ event: "decision_undo" });
    restore(entry.requestId);
    status?.announce({ message: "The question is open again." });
    return true;
  };

  // Analytics: opening, the context and its tabs, a file, and reaching the end.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    track("quick_decisions_open", { from: entry });
  }, [entry]);
  const contextFor = shown === "context" ? `${current?.request.id}:${tab}` : null;
  useEffect(() => {
    if (contextFor) track("quick_context_open", { tab: contextFor.split(":")[1] as ContextTab });
  }, [contextFor]);
  const fileShown = shown === "file" ? file?.id : null;
  useEffect(() => {
    if (fileShown) track("quick_file_open");
  }, [fileShown]);
  const done = !current;
  const doneSent = useRef(false);
  useEffect(() => {
    if (!done || doneSent.current) return;
    doneSent.current = true;
    track("quick_decisions_done", { answered_bucket: countBucket(answeredNow(userId, slug).length) });
  }, [done, userId, slug]);

  // After an answer or a snooze, focus moves to the question of the card that took its place (or the done screen's title).
  const focusKey = shown === "card" ? (current ? questionIdOf(current) : "quick-done-title") : null;
  // It waits for the card to come to rest: nothing inside an inert card can take focus.
  useEffect(() => {
    if (!acted.current || !focusKey || arriving) return;
    acted.current = false;
    document.getElementById(focusKey)?.focus();
  }, [focusKey, arriving]);
  // When the server refuses, focus goes back to the question of the card that came back.
  useEffect(() => {
    if (!refocus || arriving) return;
    const question = document.getElementById(`quick-q-${refocus}`);
    if (!question) return;
    question.focus();
    acted.current = false;
    const timer = setTimeout(() => setRefocus(null), 0);
    return () => clearTimeout(timer);
  });

  // The keyboard: the Decisions page's keys where they mean the same, plus arrows for the swipes. Never in a field or an open panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A held key repeats: only the first press counts, so holding → never sends card after card.
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || !current) return;
      const target = event.target as Element | null;
      if (target?.closest?.(TYPING) || document.querySelector("details[open], dialog[open]")) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (shown !== "card") {
        if (key !== "Escape") return;
        event.preventDefault();
        trackShortcut("quick_back");
        router.push(href({ request: current.request.id }), { scroll: false });
        return;
      }
      if (arriving) return;
      if (/^[1-9]$/.test(key)) {
        const index = Number(key) - 1;
        if (index >= current.request.options.length) return;
        event.preventDefault();
        trackShortcut("pick_option");
        if (current.request.multiple) ctl.togglePick(current, index);
        else ctl.answerOption(current, index, "keyboard");
        return;
      }
      if (key === "Enter" && current.request.multiple && target?.matches?.("input[type=checkbox]")) {
        if (!picksOf(current).length) return;
        event.preventDefault();
        trackShortcut("send_ticked");
        ctl.send(current, "keyboard");
        return;
      }
      if (key === "ArrowRight") {
        if (!ctl.sendLabel(current)) return;
        event.preventDefault();
        trackShortcut("quick_send");
        ctl.send(current, "keyboard");
        return;
      }
      if (key === "ArrowLeft" || key === "s") {
        event.preventDefault();
        trackShortcut(key === "s" ? "snooze" : "quick_snooze");
        ctl.snooze(current, "keyboard");
        return;
      }
      if (key === "c") {
        event.preventDefault();
        trackShortcut("quick_context");
        router.push(href({ request: current.request.id, view: "context" }), { scroll: false });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const close = () => remember(() => []);

  if (current && shown === "context") return <ContextView slug={slug} item={current} tab={tab} count={count} ctl={ctl} />;
  if (current && shown === "file" && file) return <FileView item={current} file={file} ctl={ctl} />;

  const sendTarget = current ? sendTargetOf(current, picksOf(current)) : null;
  const sendLabel = sendTarget === null ? null : `Send ${sendTarget}`;
  return (
    // The whole screen, the card taking what the bar and the buttons leave.
    <div data-quick-queue className="mx-auto flex w-full max-w-xl flex-1 flex-col">
      <QueueHeader slug={slug} answered={answered.length} remaining={queue.length} onClose={close} />
      {current ? (
        <>
          <div className="relative flex min-h-[24rem] flex-1 flex-col pb-2" inert={arriving} data-arriving={arriving || undefined}>
            {behind && <div aria-hidden data-behind className="surface absolute inset-x-3 top-3 bottom-0 rounded-lg border border-rule" />}
            <SwipeCard
              key={current.request.id}
              requestId={current.request.id}
              labelledBy={questionIdOf(current)}
              sendTarget={sendTarget}
              onSend={() => ctl.send(current, "swipe")}
              onSnooze={() => ctl.snooze(current, "swipe")}
              className="flex-1"
            >
              <QuickCard item={current} ctl={ctl} />
            </SwipeCard>
          </div>
          <div role="group" aria-label="Quick actions" data-quick-bar inert={arriving} className="mt-3 grid shrink-0 grid-cols-[auto_auto_minmax(0,1fr)] gap-2">
            <Button variant="secondary" size="touch" aria-keyshortcuts="ArrowLeft S" onClick={() => ctl.snooze(current, "button")}>
              <AlarmClock aria-hidden />
              Snooze
            </Button>
            <ButtonLink href={href({ request: current.request.id, view: "context" })} scroll={false} variant="secondary" size="touch" aria-keyshortcuts="C">
              <BookOpen aria-hidden />
              Context
            </ButtonLink>
            <Button
              variant="primary"
              size="touch"
              className="min-w-0"
              disabled={!sendLabel}
              aria-label={sendLabel ?? "No recommendation"}
              aria-keyshortcuts="ArrowRight"
              onClick={() => ctl.send(current, "tap")}
            >
              <Check aria-hidden />
              <span className="truncate">{current.request.multiple ? picksLabel(current.request.options, picksOf(current)) || "No picks" : (recommendedOption(current) ?? "No recommendation")}</span>
            </Button>
          </div>
          <p className="mt-2 shrink-0 text-center text-xs text-muted">
            {sendLabel ? "Swipe right to send, left to snooze." : "Swipe left to snooze."}
            <span className="hidden pointer-fine:inline"> Or use the arrow keys.</span>
          </p>
        </>
      ) : (
        <DoneView slug={slug} title={title} answered={answered} onUndo={undoFromList} />
      )}
    </div>
  );
}
