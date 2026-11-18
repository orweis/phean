"use client";

import { useEffect, useRef, useState } from "react";

import type { HillPalette, HillScene as Scene } from "./hill-scene-three";

/** The loop, as `--hill` in globals.css, and where a still frame rests: the call made at the top. */
const LOOP_MS = 13_000;
const STILL_AT = 0.74;

const TOKENS: Record<keyof HillPalette, string> = {
  dusk: "--color-dusk",
  dusk2: "--color-dusk-2",
  hill: "--color-dusk-hill",
  ink: "--color-dusk-ink",
  muted: "--color-dusk-muted",
  signal: "--color-signal",
  signalShade: "--color-signal-shade",
  accent: "--color-accent",
};

function readPalette(element: Element): HillPalette {
  const style = getComputedStyle(element);
  return Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [key, style.getPropertyValue(token).trim()])) as unknown as HillPalette;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * The boulder scene in three.js, over the drawn hill it replaces once it has painted. three.js loads
 * only when the figure comes near the screen, so it is never part of the page's first load. The loop
 * keeps time with the CSS clock beside it (`data-hill-clock`), which the decision card shares and the
 * page's pause control stops; with reduced motion there is no clock, and the scene draws one still
 * frame of the call made. It renders only while on screen and the tab is visible.
 */
export function HillScene() {
  const host = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = host.current;
    const canvas = canvasRef.current;
    if (!element || !canvas || !hasWebGL()) return;
    const figure = element.closest("[data-hill]") ?? element;
    const clock = figure.querySelector<HTMLElement>("[data-hill-clock]");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let scene: Scene | null = null;
    let frame = 0;
    let visible = false;
    let disposed = false;
    const started = performance.now();

    const paused = () => document.documentElement.hasAttribute("data-paused");
    const still = () => reduce.matches;

    /** Where the loop is: the CSS clock's own time, so the card above and the pause stay in step. */
    function progress(): number {
      if (still()) return STILL_AT;
      const animation = clock?.getAnimations()[0];
      const time = animation?.currentTime;
      const ms = typeof time === "number" ? time : performance.now() - started;
      return (ms % LOOP_MS) / LOOP_MS;
    }

    function draw() {
      if (!scene) return;
      const seconds = still() ? 0 : progress() * (LOOP_MS / 1000);
      scene.render(progress(), seconds);
    }

    function loop() {
      frame = 0;
      draw();
      if (running()) frame = requestAnimationFrame(loop);
    }

    function running() {
      return Boolean(scene) && visible && !document.hidden && !paused() && !still();
    }

    function wake() {
      if (!scene) return;
      if (running()) {
        if (!frame) frame = requestAnimationFrame(loop);
      } else {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        draw();
      }
    }

    function resize() {
      if (!scene) return;
      const { width, height } = canvas!.getBoundingClientRect();
      scene.resize(width, height);
      draw();
    }

    async function load() {
      const { createHillScene } = await import("./hill-scene-three");
      if (disposed) return;
      try {
        scene = createHillScene(canvas!, readPalette(figure));
      } catch {
        return;
      }
      resize();
      setReady(true);
      wake();
    }

    let loading = false;
    const seen = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        if (visible && !scene && !loading) {
          loading = true;
          void load();
        }
        wake();
      },
      { rootMargin: "400px 0px" },
    );
    seen.observe(element);

    const sized = new ResizeObserver(resize);
    sized.observe(canvas);

    // The theme and the appearance live on <html>; the pause control too.
    const look = new MutationObserver((changes) => {
      if (changes.some((change) => change.attributeName === "data-theme" || change.attributeName === "data-appearance")) {
        // The new tokens apply on the next style pass.
        requestAnimationFrame(() => {
          scene?.setPalette(readPalette(figure));
          draw();
        });
      }
      wake();
    });
    look.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-appearance", "data-paused"] });
    document.addEventListener("visibilitychange", wake);
    reduce.addEventListener("change", wake);

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      seen.disconnect();
      sized.disconnect();
      look.disconnect();
      document.removeEventListener("visibilitychange", wake);
      reduce.removeEventListener("change", wake);
      scene?.dispose();
      scene = null;
    };
  }, []);

  return (
    <div ref={host} aria-hidden data-scene={ready ? "ready" : "loading"} className="pointer-events-none absolute inset-0">
      <canvas
        ref={canvasRef}
        className="hill-canvas block size-full opacity-0 transition-opacity duration-700 data-[ready]:opacity-100"
        data-ready={ready || undefined}
      />
    </div>
  );
}
