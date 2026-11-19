"use client";

import { useEffect, useRef, useState } from "react";

import type { HillPalette, HillScene as Scene } from "./hill-scene-three";

/** The loop, as `--hill` in globals.css, and where a still frame rests: the call made at the top. */
const LOOP_MS = 13_000;
const STILL_AT = 0.74;
/** A frame that takes longer than this cannot keep up; two in a row and the scene draws a lighter picture. */
const SLOW_MS = 50;
const LIGHT = 0.5;
/** The first frames build shaders and upload textures; they say nothing about the ones after. */
const WARM_UP = 2;

const TOKENS: Record<keyof HillPalette, string> = {
  dusk: "--color-dusk",
  dusk2: "--color-dusk-2",
  hill: "--color-dusk-hill",
  ink: "--color-dusk-ink",
  muted: "--color-dusk-muted",
  signal: "--color-signal",
  signalShade: "--color-signal-shade",
  accent: "--color-accent",
  trim1: "--color-station-todo",
  trim2: "--color-station-done",
  trim3: "--color-station-inbox",
};

function readPalette(element: Element): HillPalette {
  const style = getComputedStyle(element);
  return Object.fromEntries(Object.entries(TOKENS).map(([key, token]) => [key, style.getPropertyValue(token).trim()])) as unknown as HillPalette;
}

/** Renderers that draw WebGL on the processor: they hold the page while they do, a second or more to start and every frame after. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;

/** `?scene=3d` draws the scene even in software, for looking at it in a headless browser. */
function forced(): boolean {
  return new URLSearchParams(window.location.search).get("scene") === "3d";
}

/** Whether the scene is worth drawing here: there is WebGL, and a GPU behind it. Otherwise the drawing stays. */
function canDraw(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const options = { failIfMajorPerformanceCaveat: !forced() };
    const gl = (canvas.getContext("webgl2", options) ?? canvas.getContext("webgl", options)) as WebGLRenderingContext | null;
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return forced() || !SOFTWARE.test(renderer);
  } catch {
    return false;
  }
}

/**
 * The boulder scene in three.js, over the drawn hill it replaces once it has painted. three.js loads
 * only when the figure comes near the screen, so it is never part of the page's first load, and the
 * scene paints its own textures as it loads, a step at a time, so it fetches nothing else. Where
 * there is no WebGL, or only WebGL drawn in software, the drawing stays and none of it loads. The loop
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
    if (!element || !canvas || !canDraw()) return;
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

    /*
     * Keeping up: the time from one frame to the next is what that frame cost, drawing and showing.
     * Where that stays long (a phone short of breath, or a machine drawing WebGL in software, which
     * holds the page while it does), the scene halves its resolution, and if that is not enough it
     * rests between frames so the page stays free. A still frame is always drawn in full.
     */
    let light = false;
    let drawn = 0;
    let drewAt = 0;
    let slow = 0;
    let rest = 0;

    function loop(now: number) {
      frame = 0;
      if (drewAt) {
        const cost = now - drewAt;
        drewAt = 0;
        const behind = drawn > WARM_UP && cost > SLOW_MS;
        slow = behind ? slow + 1 : 0;
        if (behind && light) {
          rest = window.setTimeout(
            () => {
              rest = 0;
              if (running()) frame = requestAnimationFrame(loop);
            },
            Math.min(1000, cost * 2),
          );
          return;
        }
        // Two slow frames running, or one hopelessly so.
        if (slow >= 2 || (behind && cost > SLOW_MS * 4)) {
          light = true;
          scene?.setQuality(LIGHT);
        }
      }
      draw();
      drawn += 1;
      drewAt = now;
      if (running()) frame = requestAnimationFrame(loop);
    }

    function running() {
      return Boolean(scene) && visible && !document.hidden && !paused() && !still();
    }

    function wake() {
      if (!scene) return;
      if (running()) {
        scene.setQuality(light ? LIGHT : 1);
        if (!frame && !rest) frame = requestAnimationFrame(loop);
      } else {
        if (frame) cancelAnimationFrame(frame);
        if (rest) window.clearTimeout(rest);
        frame = rest = drewAt = slow = 0;
        scene.setQuality(1);
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
      let made: Scene;
      try {
        made = await createHillScene(canvas!, readPalette(figure));
      } catch {
        return;
      }
      if (disposed) {
        made.dispose();
        return;
      }
      scene = made;
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
      if (rest) window.clearTimeout(rest);
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
