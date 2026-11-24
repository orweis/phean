"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
      {/* The picture is decoration; the steps below it are the story in words. */}
      <div aria-hidden className="motion-reduce:hidden">
        {picture}
      </div>
      {steps}
    </div>
  );
}
