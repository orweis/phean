"use client";

import { Check, Scale } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";

/** What the card and the scene say to each other, as events on the figure (`[data-hill]`). */
export const HILL_HOLD = "hill:hold";
export const HILL_ANSWER = "hill:answer";
export type HillAnswer = "ship" | "hold";

/**
 * The call the crew stopped for, as the Decisions page shows it. Most of the time it is part of the
 * picture: it shows as the boulder reaches the top and its answer is picked on the loop's clock
 * (globals.css), and nothing in it can be used. From the third loop on, the scene stops at the question
 * every time and waits (`HILL_HOLD`): then the card is the visitor's, its buttons work, "Ship it" is ringed and
 * a line says it is their call. Either answer is the call made (`HILL_ANSWER`), and the scene goes on:
 * the boulder leaves in light if they ship it, and rolls back down the hill if they hold a week.
 *
 * It sits in the sky above the person on a wide screen and on the hill's open face below them on a
 * narrower one. Under 768px there is no room for it in the picture, so it shows only when it is the
 * visitor's turn, over the foot of the hill (hidden with `visibility`, not `display`, so its animation
 * keeps the loop's time while it is out of sight).
 */
export function HillCard() {
  const card = useRef<HTMLDivElement>(null);
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    const figure = card.current?.closest("[data-hill]");
    if (!figure) return;
    const held = (event: Event) => setHolding(Boolean((event as CustomEvent<boolean>).detail));
    figure.addEventListener(HILL_HOLD, held);
    return () => figure.removeEventListener(HILL_HOLD, held);
  }, []);

  const answer = (choice: HillAnswer) => card.current?.closest("[data-hill]")?.dispatchEvent(new CustomEvent<HillAnswer>(HILL_ANSWER, { detail: choice }));

  return (
    <div
      ref={card}
      data-hill-card
      data-holding={holding || undefined}
      role="group"
      aria-label="The crew’s question"
      aria-hidden={!holding || undefined}
      inert={!holding}
      className="absolute right-[3%] bottom-[5%] w-[min(15rem,40%)] rounded-lg bg-panel p-3 text-left shadow-lift max-md:right-auto max-md:-bottom-[10%] max-md:left-[3%] max-md:invisible max-md:w-[min(17rem,64%)] max-md:data-[holding]:visible xl:top-[3%] xl:bottom-auto xl:w-[19rem] xl:p-4"
    >
      <p className="flex items-center gap-2">
        <Badge tone="warning">
          <Scale />
          Decision
        </Badge>
        <span className="text-xs text-muted">from 3 agents</span>
      </p>
      <p className="mt-2 text-xs font-semibold text-ink xl:text-sm">The launch is ready. Ship it on Monday?</p>
      <p className="mt-2 flex gap-1.5">
        <button
          type="button"
          data-hill-pick
          onClick={() => answer("ship")}
          className="relative inline-flex h-7 items-center gap-1 rounded-full bg-accent-tint px-3 text-xs font-semibold text-accent-ink ring-2 ring-accent ring-inset"
        >
          <Check className="size-3.5" />
          Ship it
        </button>
        <button type="button" data-hill-other onClick={() => answer("hold")} className="inline-flex h-7 items-center rounded-full bg-fill px-3 text-xs font-semibold text-ink-2">
          Hold a week
        </button>
      </p>
      {holding ? <p className="mt-2.5 text-xs font-semibold text-signal-ink">Your call: ship it, or hold a week?</p> : null}
    </div>
  );
}
