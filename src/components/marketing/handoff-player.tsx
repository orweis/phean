"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { beatAt, HANDOFF_FRONT, HANDOFF_LOOP_MS, openAt } from "./handoff-beats";

/**
 * The handoff story's player: it moves the stage's `--beat` along `HANDOFF_BEATS` (with the window in
 * front and the windows open), and the stylesheet brings each piece in and out from that. The clock runs only while the stage is on screen, the tab is
 * visible, and neither its own Pause nor the page's (`data-paused` on the root) holds it, and it goes
 * on from where it stopped. With reduced motion it never starts: the storyboard stands in for it.
 */
export function HandoffPlayer({ picture, steps }: { picture: ReactNode; steps: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const held = useRef(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    held.current = paused;
  }, [paused]);

  useEffect(() => {
    const element = stage.current;
    if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let elapsed = 0;
    let last = performance.now();
    let beat = -1;
    let inView = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const show = (next: number) => {
      if (next === beat) return;
      beat = next;
      element.style.setProperty("--beat", String(next));
      // Which app is in front, and which are open: where the windows overlap, they follow the story.
      element.dataset.front = HANDOFF_FRONT[next];
      element.dataset.open = openAt(next);
    };
    const running = () => inView && !document.hidden && !held.current && !document.documentElement.hasAttribute("data-paused");
    const tick = () => {
      const now = performance.now();
      const on = running();
      if (on) elapsed = (elapsed + now - last) % HANDOFF_LOOP_MS;
      last = now;
      element.toggleAttribute("data-running", on);
      show(beatAt(elapsed));
    };
    // Only tick while it can be seen; a hidden tab or a stage off screen costs nothing.
    const sync = () => {
      const want = inView && !document.hidden;
      if (want && !timer) {
        last = performance.now();
        timer = setInterval(tick, 100);
      } else if (!want && timer) {
        clearInterval(timer);
        timer = undefined;
        element.removeAttribute("data-running");
      }
    };
    show(0);
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry!.isIntersecting;
        sync();
      },
      // Some of it in the middle of the screen, however tall the stage is next to the screen.
      { rootMargin: "-20% 0px -20% 0px" },
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <div ref={stage} data-handoff>
      <div className="mb-3 flex justify-end motion-reduce:hidden">
        <Button size="sm" variant="ghost" aria-pressed={paused} onClick={() => setPaused(!paused)}>
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? "Play the handoff" : "Pause the handoff"}
        </Button>
      </div>
      {/* The picture is decoration (each app in it is hidden from screen readers); the steps below it are the story in words. */}
      <div className="motion-reduce:hidden">{picture}</div>
      {steps}
    </div>
  );
}

/**
 * Phean as the server both agents talk to, from 1024px: a node with the task's state beside it
 * (`left`, `right`), and the Phean window (`tip`) shown under it while the node is hovered, focused
 * from the keyboard, or tapped, and closed by Escape, a second tap, or a tap elsewhere. It opens
 * above the node when there is no room below. Under 1024px the node goes, and the window takes its
 * place among the cascaded windows (the wrappers are `display: contents` there).
 */
export function HandoffHub({
  node,
  description,
  left,
  right,
  tip,
}: {
  node: ReactNode;
  description: string;
  left: ReactNode;
  right: ReactNode;
  tip: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [above, setAbove] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const tipId = useId();
  const descriptionId = useId();
  const open = hovered || focused || pinned;

  // Room below the node for the window, or else above it.
  useEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const node = anchor.current.getBoundingClientRect();
    const height = panel.current.offsetHeight + 16;
    setAbove(node.bottom + height > innerHeight && node.top - height > 0);
  }, [open]);

  // A tap elsewhere closes a pinned window.
  useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);

  const close = () => {
    setHovered(false);
    setFocused(false);
    setPinned(false);
  };

  return (
    <div className="max-lg:contents lg:col-span-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-8">
      <div aria-hidden className="justify-self-end max-lg:hidden">
        {left}
      </div>
      <div
        ref={anchor}
        className="max-lg:contents lg:relative"
        onPointerEnter={(event) => event.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={(event) => event.pointerType === "mouse" && setHovered(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            close();
          }
        }}
      >
        <button
          type="button"
          data-node
          aria-expanded={open}
          aria-controls={tipId}
          aria-describedby={descriptionId}
          onClick={() => setPinned(!pinned)}
          onFocus={(event) => setFocused(event.currentTarget.matches(":focus-visible"))}
          onBlur={() => setFocused(false)}
          className="max-lg:hidden"
        >
          {node}
        </button>
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
        <div
          ref={panel}
          id={tipId}
          data-tip={open ? "open" : undefined}
          data-above={above || undefined}
          className="max-lg:contents lg:invisible lg:absolute lg:left-1/2 lg:z-30 lg:w-[54rem] lg:max-w-[calc(100vw-3rem)] lg:-translate-x-1/2 lg:glass-float lg:rounded-2xl lg:p-2 lg:data-[above]:bottom-full lg:data-[above]:mb-3 lg:not-data-[above]:top-full lg:not-data-[above]:mt-3 lg:data-[tip=open]:visible lg:data-[tip=open]:animate-glass-in"
        >
          {tip}
        </div>
      </div>
      <div aria-hidden className="max-lg:hidden">
        {right}
      </div>
    </div>
  );
}
