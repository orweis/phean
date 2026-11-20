"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { IDLE_PER_MS } from "./hill/cast";
import { approach, branchAt, LOOP_MS, momentAt, type Choice } from "./hill/timeline";
import { HILL_ANSWER, HILL_HOLD, type HillAnswer } from "./hill-card";
import type { HillPalette, HillScene as Scene } from "./hill-scene-three";

/** The loop, as `--hill` in globals.css, and where a still frame rests: the call made, the phone held up and the boulder alight, about to go. */
const STILL_AT = 0.582;
/** A frame that takes longer than this cannot keep up; two in a row and the scene draws a lighter picture. */
const SLOW_MS = 50;
const LIGHT = 0.5;
/** The first frames build shaders and upload textures; they say nothing about the ones after. */
const WARM_UP = 2;
/** How much of the figure must be in view before the loop first plays: enough that its first frame is seen. */
const IN_VIEW = 0.4;
/** How quickly the crew's attention follows the pointer, and comes and goes: the time to get halfway, in milliseconds. */
const FOLLOW_MS = 110;
const ATTEND_MS = 220;

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

let drawable: boolean | undefined;
/** `canDraw`, asked once: the answer does not change while the page is open. */
function canDrawOnce(): boolean {
  drawable ??= canDraw();
  return drawable;
}

function never(): () => void {
  return () => {};
}

/**
 * The boulder scene in three.js, over the drawn hill it replaces once it has painted. three.js loads
 * only when the figure comes near the screen, so it is never part of the page's first load, and the
 * scene paints its own textures as it loads, a step at a time, and fetches only the person's model. Where
 * there is no WebGL, or only WebGL drawn in software, the drawing stays and none of it loads. The loop
 * keeps time with the CSS clock beside it (`data-hill-clock`), which the decision card shares and the
 * page's pause control stops; with reduced motion there is no clock, and the scene draws one still
 * frame of the call made. It renders only while on screen and the tab is visible.
 */
export function HillScene() {
  const host = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  // Known only in the browser; the server, and the first paint, assume the scene will come.
  const able = useSyncExternalStore(never, canDrawOnce, () => true);
  const state = ready ? "ready" : able ? "loading" : "poster";

  /*
   * The loop plays only while it is watched. Its clock (and the card's animations with it) is held at
   * its first moment until the figure has come well into view, so the visitor sees the first loop from
   * its first frame, and stops again whenever the figure is off screen or the tab is hidden: `data-playing`
   * on the figure is what lets them run (globals.css); until it is set they wait, from the page's first paint.
   * This is so whether the scene is drawn or the drawing stands in for it.
   */
  useEffect(() => {
    const figure = host.current?.closest("[data-hill]");
    if (!figure) return;
    let started = false;
    let onScreen = false;
    const play = () => figure.toggleAttribute("data-playing", started && onScreen && !document.hidden);
    const watched = new IntersectionObserver(
      ([entry]) => {
        onScreen = Boolean(entry?.isIntersecting);
        if (entry && entry.intersectionRatio >= IN_VIEW) started = true;
        play();
      },
      { threshold: [0, IN_VIEW] },
    );
    watched.observe(figure);
    document.addEventListener("visibilitychange", play);
    return () => {
      watched.disconnect();
      document.removeEventListener("visibilitychange", play);
      figure.removeAttribute("data-playing");
    };
  }, []);

  useEffect(() => {
    const element = host.current;
    const canvas = canvasRef.current;
    // Where the scene will not come, the drawing stays, and shows the call.
    if (!element || !canvas || !able) return;
    const figure = element.closest("[data-hill]") ?? element;
    const clock = figure.querySelector<HTMLElement>("[data-hill-clock]");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let scene: Scene | null = null;
    let frame = 0;
    let visible = false;
    let disposed = false;

    const paused = () => document.documentElement.hasAttribute("data-paused") || !figure.hasAttribute("data-playing");
    const still = () => reduce.matches;

    /*
     * The visitor's turn. The loop plays through twice; the third time the crew reaches the top, and
     * every time after, the clock is stopped at the question (`data-hold` on the figure stops the card's animations with
     * it), the card is handed over (HILL_HOLD), and the scene idles until they answer. Loops are counted
     * on the clock, never on frames: if it ran on while nothing was drawn (off screen, a hidden tab),
     * it is put back to the hold it should have stopped at.
     */
    let answered = 0;
    let holding = false;
    /** While it waits, the idle motion (breathing, blinking) runs on: the time waited, in all and since this hold began. */
    let waited = 0;
    let heldSince = 0;
    let choice: Choice = "ship";
    const clocks = () => figure.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getComputedTiming().duration === LOOP_MS);

    function hold(time: number) {
      // Back to the moment it should have stopped at, however far the clock ran on unseen.
      for (const animation of clocks()) if (animation.currentTime !== time) animation.currentTime = time;
      if (holding) return;
      holding = true;
      heldSince = performance.now();
      figure.setAttribute("data-hold", "");
      figure.dispatchEvent(new CustomEvent<boolean>(HILL_HOLD, { detail: true }));
    }

    function answer(event: Event) {
      if (!holding) return;
      holding = false;
      answered += 1;
      waited += performance.now() - heldSince;
      // Either answer is the call made, and the rest of this loop goes its way (the card shows which, by `data-choice`).
      choice = (event as CustomEvent<HillAnswer>).detail === "hold" ? "hold" : "ship";
      figure.removeAttribute("data-hold");
      figure.dispatchEvent(new CustomEvent<boolean>(HILL_HOLD, { detail: false }));
      wake();
    }
    figure.addEventListener(HILL_ANSWER, answer);

    /*
     * While it waits, the crew looks where the visitor points: at the pointer over the figure (the last
     * touch, on a touch screen), or at the button that has the keyboard's focus. That is an input like
     * the clock: the scene is told where (as fractions across and down the figure) and how much they
     * attend, both eased here a step at a time so nothing snaps, and it works the heads out from that.
     */
    const pointer = { x: 0.5, y: 0.5, on: false };
    const focus = { x: 0.5, y: 0.5, on: false };
    const look = { x: 0.5, y: 0.4, weight: 0 };
    let lookedAt = 0;
    const within = (clientX: number, clientY: number) => {
      const box = canvas.getBoundingClientRect();
      return { x: (clientX - box.left) / box.width, y: (clientY - box.top) / box.height };
    };
    const pointed = (event: Event) => {
      Object.assign(pointer, within((event as PointerEvent).clientX, (event as PointerEvent).clientY), { on: true });
    };
    const unpointed = () => {
      pointer.on = false;
    };
    const focused = (event: Event) => {
      const box = (event.target as Element).getBoundingClientRect();
      Object.assign(focus, within(box.left + box.width / 2, box.top + box.height / 2), { on: true });
    };
    const unfocused = () => {
      focus.on = false;
    };
    figure.addEventListener("pointermove", pointed);
    figure.addEventListener("pointerdown", pointed);
    figure.addEventListener("pointerleave", unpointed);
    figure.addEventListener("pointercancel", unpointed);
    figure.addEventListener("focusin", focused);
    figure.addEventListener("focusout", unfocused);
    /** Eases the look on by the time since it was last eased. */
    function attend(now: number) {
      const elapsed = lookedAt ? Math.min(100, now - lookedAt) : 0;
      lookedAt = now;
      // The pointer if it is over the figure, else the focused button; neither, and they look back to the work.
      const at = pointer.on ? pointer : focus.on ? focus : null;
      const attending = holding && at !== null;
      if (at) {
        // From nothing, straight to where it is; after that, following it.
        const follow = look.weight < 0.01 ? 0 : FOLLOW_MS;
        look.x = follow ? approach(look.x, at.x, elapsed, follow) : at.x;
        look.y = follow ? approach(look.y, at.y, elapsed, follow) : at.y;
      }
      look.weight = approach(look.weight, attending ? 1 : 0, elapsed, ATTEND_MS);
      if (look.weight < 0.001 && !attending) look.weight = 0;
    }

    /** Where the loop is: the CSS clock's own time, so the card above and the pause stay in step. */
    function draw() {
      if (!scene) return;
      const time = clock?.getAnimations()[0]?.currentTime;
      if (still() || typeof time !== "number") {
        scene.render({ progress: STILL_AT });
        return;
      }
      const moment = momentAt(time, answered);
      if (moment.held) hold(moment.time);
      const branch = branchAt(moment.time, answered, choice);
      if (branch === "hold") figure.setAttribute("data-choice", "hold");
      else figure.removeAttribute("data-choice");
      const now = performance.now();
      const waiting = waited + (holding ? now - heldSince : 0);
      attend(now);
      scene.render({ progress: moment.progress, idle: (moment.time + waiting) * IDLE_PER_MS, branch, loop: moment.loop, look: look.weight > 0 ? look : undefined });
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
    const themed = new MutationObserver((changes) => {
      if (changes.some((change) => change.attributeName === "data-theme" || change.attributeName === "data-appearance")) {
        // The new tokens apply on the next style pass.
        requestAnimationFrame(() => {
          scene?.setPalette(readPalette(figure));
          draw();
        });
      }
      wake();
    });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-appearance", "data-paused"] });
    // And whether the loop is playing at all (the figure in view, the tab showing) is on the figure.
    const playing = new MutationObserver(wake);
    playing.observe(figure, { attributes: true, attributeFilter: ["data-playing"] });
    document.addEventListener("visibilitychange", wake);
    reduce.addEventListener("change", wake);

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      if (rest) window.clearTimeout(rest);
      figure.removeEventListener(HILL_ANSWER, answer);
      figure.removeAttribute("data-hold");
      figure.removeAttribute("data-choice");
      seen.disconnect();
      sized.disconnect();
      themed.disconnect();
      playing.disconnect();
      figure.removeEventListener("pointermove", pointed);
      figure.removeEventListener("pointerdown", pointed);
      figure.removeEventListener("pointerleave", unpointed);
      figure.removeEventListener("pointercancel", unpointed);
      figure.removeEventListener("focusin", focused);
      figure.removeEventListener("focusout", unfocused);
      document.removeEventListener("visibilitychange", wake);
      reduce.removeEventListener("change", wake);
      scene?.dispose();
      scene = null;
    };
  }, [able]);

  return (
    <div ref={host} aria-hidden data-scene={state} className="pointer-events-none absolute inset-0">
      <canvas
        ref={canvasRef}
        className="hill-canvas block size-full opacity-0 transition-opacity duration-700 data-[ready]:opacity-100"
        data-ready={ready || undefined}
      />
    </div>
  );
}
