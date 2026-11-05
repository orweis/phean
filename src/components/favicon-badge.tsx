"use client";

import { useEffect } from "react";

import { faviconBadgeText } from "@/lib/favicon";

import { MARK } from "./logo";

/** Drawn at 64px, so it stays crisp on high-density tabs. */
const SIZE = 64;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

/** The scale from the mark's 32-unit square to the canvas. */
const UNIT = SIZE / 32;

/**
 * The boulder's colours as `src/app/icon.svg` paints them (the dark-appearance ember, lit and
 * shaded), so the count reads as the same boulder, and dark figures on it.
 */
const BOULDER = { lit: "#fa934e", shade: "#d96533", figures: "#2b1408" };

/** The faint light rim `src/app/icon.svg` draws around the tile, in the mark's units. */
const RIM = { inset: 0.6, radius: 6.9, width: 1.2, colour: "rgb(255 255 255 / 0.3)" };

/**
 * The mark with the count as its boulder: a larger ember boulder, lit from the upper left like
 * the original, drawn where the original rests on the slope and covering it, so there is one
 * boulder and it carries the number.
 */
async function drawBadge(iconUrl: string, text: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext("2d")!;
  context.drawImage(await loadImage(iconUrl), 0, 0, SIZE, SIZE);

  // Covers the original boulder (radius 6.4 units) with room for figures that read at 16px, and
  // leaves enough of the tile and the slope around it that the mark still reads as Phean's.
  context.font = `800 ${text.length > 2 ? 21 : text.length > 1 ? 27 : 34}px system-ui, -apple-system, sans-serif`;
  const height = 38;
  const width = Math.max(height, context.measureText(text).width + 8);
  const centerX = Math.min(Math.max(MARK.boulder.cx * UNIT, width / 2 + 1), SIZE - width / 2 - 1);
  const centerY = MARK.boulder.cy * UNIT;
  const shape = (inset: number, dx = 0, dy = 0) => {
    context.beginPath();
    context.roundRect(centerX - width / 2 + inset + dx, centerY - height / 2 + inset + dy, width - 2 * inset, height - 2 * inset, (height - 2 * inset) / 2);
  };

  shape(0);
  context.fillStyle = BOULDER.shade;
  context.fill();
  // The lit face: the same shape nudged up and to the left, kept inside the boulder.
  context.save();
  shape(0);
  context.clip();
  shape(2.5, -2.5, -2.5);
  context.fillStyle = BOULDER.lit;
  context.fill();
  context.restore();

  context.fillStyle = BOULDER.figures;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, centerX - 1, centerY + 1.5);

  // The icon's rim, drawn again over the boulder so the tile's edge stays unbroken.
  context.beginPath();
  context.roundRect(RIM.inset * UNIT, RIM.inset * UNIT, SIZE - 2 * RIM.inset * UNIT, SIZE - 2 * RIM.inset * UNIT, RIM.radius * UNIT);
  context.lineWidth = RIM.width * UNIT;
  context.strokeStyle = RIM.colour;
  context.stroke();
  return canvas.toDataURL("image/png");
}

/** Every icon link in the head; the page's own is an SVG with `sizes="any"`, which Chrome prefers to any PNG beside it. */
const iconLinks = () => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];

/** Puts each icon link back to the plain mark. */
function restore(links: readonly HTMLLinkElement[]) {
  for (const link of links) {
    if (link.dataset.plainHref === undefined) continue;
    link.href = link.dataset.plainHref;
    if (link.dataset.plainType) link.type = link.dataset.plainType;
    else link.removeAttribute("type");
    delete link.dataset.badge;
    delete link.dataset.plainHref;
    delete link.dataset.plainType;
  }
}

/** The plain mark's address: kept aside on a badged link, else its own. */
const plainHref = (link: HTMLLinkElement) => link.dataset.plainHref ?? link.getAttribute("href") ?? "";

/**
 * Puts the count of what waits on a person (decisions, approvals, new inbox tasks) on the tab's
 * favicon, the way mail apps show unread mail, so a person sees it from another tab. The badge is
 * drawn into the page's own icon links rather than a new one, because browsers choose among icon
 * links by size and type, not by order, and keep the scalable SVG over an added PNG. A refresh can
 * render the head's icon afresh, so a watch on the head puts the badge back whenever the plain mark
 * returns. With nothing waiting the plain mark stays. The workspace's auto-refresh keeps the count
 * current.
 */
export function FaviconBadge({ count }: { count: number }) {
  useEffect(() => {
    const text = faviconBadgeText(count);
    const first = iconLinks()[0];
    if (!text || !first) return;
    let badged: string | null = null;

    const apply = () => {
      if (!badged) return;
      for (const link of iconLinks()) {
        if (link.dataset.badge === text && link.getAttribute("href") === badged) continue;
        if (link.dataset.plainHref === undefined) {
          link.dataset.plainHref = link.getAttribute("href") ?? "";
          link.dataset.plainType = link.getAttribute("type") ?? "";
        }
        link.type = "image/png";
        link.href = badged;
        link.dataset.badge = text;
      }
    };
    const watch = new MutationObserver(apply);
    let cancelled = false;
    void drawBadge(plainHref(first), text)
      .then((href) => {
        if (cancelled) return;
        badged = href;
        apply();
        watch.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      watch.disconnect();
      restore(iconLinks());
    };
  }, [count]);
  return null;
}
