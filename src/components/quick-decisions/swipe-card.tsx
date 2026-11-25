"use client";

import { AlarmClock, Ban, Check } from "lucide-react";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";

import { cx } from "@/lib/cx";
import { hintOpacity, isArmed, isSidewaysDrag, isVerticalDrag, swipeIntent, tiltOf } from "@/lib/quick-decisions";

/** Where a drag may not start: fields, links (a browser drags those itself) and an open panel. */
const NO_DRAG = "input:not([type=checkbox]), textarea, select, a, details[open] > :not(summary)";

/** How long the card takes to fly off before its action runs, in milliseconds. */
const FLY_MS = 200;

/** How much of the ground behind the card must show, in CSS pixels, before its words do. */
const WORDS_FIT = 72;

const stillPreferred = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A short tap of the phone's motor as a drag crosses the threshold, where the browser has one. */
function tap() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
}

interface SwipeCardProps {
  /** What a swipe right sends, in words (“Okafor LLP”, Blog + Changelog), or null when there is nothing to send. */
  sendTarget: string | null;
  onSend: () => void;
  onSnooze: () => void;
  /** The id of the question, which names the card. */
  labelledBy: string;
  requestId: string;
  className?: string;
  children: ReactNode;
}

/**
 * What lies behind the card on the side it uncovers: the colour of the action and, centred in the
 * strip the card has uncovered so it reads at any distance, its icon and words. Past the threshold
 * the icon fills and grows a little and the words are at full strength, so the person knows that
 * letting go acts.
 */
function Underlay({ side, sendTarget, reveal, armed, opacity }: { side: "send" | "snooze"; sendTarget: string | null; reveal: number; armed: boolean; opacity: number }) {
  const nothing = side === "send" && sendTarget === null;
  const look = nothing
    ? { ground: "bg-fill text-ink-2", disc: "bg-panel text-ink-2" }
    : side === "send"
      ? { ground: "bg-accent-tint text-accent-ink", disc: armed ? "bg-accent text-on-accent" : "bg-panel text-accent-ink" }
      : { ground: "bg-wait-tint text-wait-ink", disc: armed ? "bg-wait-ink text-wait-tint" : "bg-panel text-wait-ink" };
  const Icon = nothing ? Ban : side === "send" ? Check : AlarmClock;
  const [title, detail] = nothing ? ["Nothing to send", "Pick an answer"] : side === "send" ? ["Send", sendTarget] : ["Snooze", "To the back"];
  return (
    <div aria-hidden data-swipe-hint={side} data-armed={(armed && !nothing) || undefined} className={cx("absolute inset-0 overflow-hidden rounded-lg", look.ground)}>
      <div
        data-swipe-label
        className={cx("absolute inset-y-0 flex flex-col items-center justify-center gap-1.5 text-center", side === "send" ? "left-0" : "right-0")}
        style={{ width: reveal, opacity }}
      >
        <span
          className={cx(
            "grid size-11 shrink-0 place-items-center rounded-full motion-safe:transition-[transform,background-color,color] motion-safe:duration-(--dur-micro)",
            look.disc,
            armed && !nothing && "scale-110",
          )}
        >
          <Icon className="size-5" strokeWidth={2.5} />
        </span>
        {/* The words wait until they fit beside the card, rather than showing as a stub. */}
        <span className={cx("mt-1 flex max-w-full flex-col items-center", reveal < WORDS_FIT && "invisible")}>
          <span className="max-w-full truncate px-2 text-md font-semibold">{title}</span>
          <span className="max-w-full truncate px-2 text-sm">{detail}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The card on screen, which follows a finger (or a mouse) sideways one to one, tilting a little the
 * same way on either side: past `SWIPE_THRESHOLD` to the right it sends the recommended answer or the
 * picks, to the left it snoozes (each flying off that way), and short of it it springs back. While it
 * moves, what lies behind it names exactly what letting go will do, and crossing the threshold taps
 * the phone's motor. Only a clearly sideways drag moves it (`touch-action: pan-y` leaves up and down
 * to the page), and every swipe has a button on the page that does the same. With reduced motion it
 * neither tilts nor flies.
 */
export function SwipeCard({ sendTarget, onSend, onSnooze, labelledBy, requestId, className, children }: SwipeCardProps) {
  const canSend = sendTarget !== null;
  const card = useRef<HTMLElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; mode: "pending" | "sideways" | "scroll"; armed: boolean } | null>(null);
  const offset = useRef(0);
  /** A drag happened: the click that ends it must not press the button it started on. */
  const dragged = useRef(false);
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<{ intent: "send" | "snooze"; from: number } | null>(null);
  /** Reduced motion, read when a drag starts: the card then follows the finger without tilting. */
  const [still, setStill] = useState(false);

  const move = (value: number) => {
    offset.current = value;
    setDx(value);
  };

  const act = (intent: "send" | "snooze") => {
    const run = intent === "send" ? onSend : onSnooze;
    if (stillPreferred()) {
      move(0);
      run();
      return;
    }
    setLeaving({ intent, from: offset.current });
    setTimeout(() => {
      run();
      // The card is usually gone by now; when it stays (the only one, snoozed), it comes back to rest.
      setLeaving(null);
      move(0);
    }, FLY_MS);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (leaving || (event.pointerType === "mouse" && event.button !== 0)) return;
    if ((event.target as Element).closest(NO_DRAG)) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, mode: "pending", armed: false };
    setStill(stillPreferred());
    dragged.current = false;
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId || state.mode === "scroll") return;
    const x = event.clientX - state.x;
    const y = event.clientY - state.y;
    if (state.mode === "pending") {
      if (isVerticalDrag(x, y)) {
        state.mode = "scroll";
        return;
      }
      if (!isSidewaysDrag(x, y)) return;
      state.mode = "sideways";
      dragged.current = true;
      card.current?.setPointerCapture(event.pointerId);
      // A mouse drag may have started selecting the question; a selection left behind would be dragged by the next one.
      window.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    const armed = swipeIntent(x, canSend) !== null;
    if (armed && !state.armed) tap();
    state.armed = armed;
    move(x);
  };

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    drag.current = null;
    if (state.mode !== "sideways") return;
    const intent = event.type === "pointercancel" ? null : swipeIntent(offset.current, canSend);
    if (intent) act(intent);
    else move(0);
  };

  // While it flies off, the card keeps its place behind the words it uncovered.
  const at = leaving ? leaving.from : dx;
  const intent = leaving?.intent ?? swipeIntent(dx, canSend);
  const direction = leaving ? (leaving.intent === "send" ? 1 : -1) : Math.sign(dx);
  const transform = leaving
    ? `translateX(${leaving.intent === "send" ? 120 : -120}%) rotate(${still ? 0 : leaving.intent === "send" ? 12 : -12}deg)`
    : dx
      ? `translateX(${dx}px) rotate(${still ? 0 : tiltOf(dx)}deg)`
      : undefined;

  return (
    <div className="relative flex flex-1 flex-col" data-swipe={intent ?? undefined}>
      {direction !== 0 && (
        <Underlay side={direction > 0 ? "send" : "snooze"} sendTarget={sendTarget} reveal={Math.abs(at)} armed={leaving !== null || isArmed(dx)} opacity={leaving ? 1 : hintOpacity(dx)} />
      )}
      <article
        ref={card}
        aria-labelledby={labelledBy}
        data-quick-card={requestId}
        data-dragging={dx !== 0 && !leaving ? "" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDragStart={(event) => {
          // The browser's own drag of a selection or an image would cancel the swipe.
          if (drag.current) event.preventDefault();
        }}
        onClickCapture={(event) => {
          if (!dragged.current) return;
          dragged.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        style={{ transform, opacity: leaving ? 0 : undefined }}
        className={cx(
          "surface relative flex touch-pan-y flex-col rounded-lg border border-rule",
          "motion-safe:transition-[transform,opacity] motion-safe:duration-(--dur-short) motion-safe:ease-out data-dragging:transition-none data-dragging:select-none",
          className,
        )}
      >
        {children}
      </article>
    </div>
  );
}
