"use client";

import { AlarmClock, Check } from "lucide-react";
import { useRef, useState, type PointerEvent, type ReactNode } from "react";

import { cx } from "@/lib/cx";
import { dragOffset, isSidewaysDrag, isVerticalDrag, swipeIntent, swipeProgress, tiltOf } from "@/lib/quick-decisions";

/** Where a drag may not start: fields, links (a browser drags those itself) and an open panel. */
const NO_DRAG = "input:not([type=checkbox]), textarea, select, a, details[open] > :not(summary)";

/** How long the card takes to fly off before its action runs, in milliseconds. */
const FLY_MS = 200;

const stillPreferred = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface SwipeCardProps {
  /** Whether a swipe right has something to send: a recommended option, or picks. */
  canSend: boolean;
  /** What a swipe right sends, in words: "Send “Okafor LLP”", "Send Blog + Changelog". */
  sendLabel: string;
  onSend: () => void;
  onSnooze: () => void;
  /** The id of the question, which names the card. */
  labelledBy: string;
  requestId: string;
  className?: string;
  children: ReactNode;
}

/**
 * The card on screen, which follows a finger (or a mouse) sideways: past `SWIPE_THRESHOLD` to the
 * right it sends the recommended answer or the picks, to the left it snoozes, and short of it it
 * springs back. While it moves, the colour behind it names exactly what letting go will do. Only a
 * clearly sideways drag moves it (`touch-action: pan-y` leaves up and down to the page), and every
 * swipe has a button on the page that does the same. With reduced motion it neither tilts nor flies.
 */
export function SwipeCard({ canSend, sendLabel, onSend, onSnooze, labelledBy, requestId, className, children }: SwipeCardProps) {
  const card = useRef<HTMLElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; mode: "pending" | "sideways" | "scroll" } | null>(null);
  const offset = useRef(0);
  /** A drag happened: the click that ends it must not press the button it started on. */
  const dragged = useRef(false);
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<"send" | "snooze" | null>(null);
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
    setLeaving(intent);
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
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, mode: "pending" };
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
    }
    event.preventDefault();
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

  const shown = leaving ? 0 : dragOffset(dx, canSend);
  const intent = leaving ?? swipeIntent(dx, canSend);
  const direction = leaving ? (leaving === "send" ? 1 : -1) : Math.sign(dx);
  const transform = leaving
    ? `translateX(${leaving === "send" ? 120 : -120}%) rotate(${leaving === "send" ? 10 : -10}deg)`
    : dx
      ? `translateX(${shown}px) rotate(${still ? 0 : tiltOf(shown)}deg)`
      : undefined;

  return (
    <div className="relative" data-swipe={intent ?? undefined}>
      {direction !== 0 && (
        <div
          aria-hidden
          data-swipe-hint={direction > 0 ? "send" : "snooze"}
          className={cx(
            "absolute inset-0 flex items-center rounded-lg px-6 text-md font-semibold",
            direction > 0 ? (canSend ? "justify-start bg-accent-tint text-accent-ink" : "justify-start bg-fill text-muted") : "justify-end bg-wait-tint text-wait-ink",
          )}
          style={{ opacity: leaving ? 1 : 0.35 + 0.65 * swipeProgress(dx) }}
        >
          {direction > 0 ? (
            canSend ? (
              <span className="flex min-w-0 items-center gap-2">
                <Check className="size-5 shrink-0" />
                <span className="line-clamp-2 wrap-anywhere">{sendLabel}</span>
              </span>
            ) : (
              "Nothing recommended to send"
            )
          ) : (
            <span className="flex items-center gap-2">
              Snooze
              <AlarmClock className="size-5 shrink-0" />
            </span>
          )}
        </div>
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
