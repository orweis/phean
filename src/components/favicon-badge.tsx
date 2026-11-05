"use client";

import { useEffect } from "react";

import { faviconBadgeText } from "@/lib/favicon";

/** Drawn at 64px, so it stays crisp on high-density tabs. */
const SIZE = 64;

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

/** The mark with an ember count in its top-right corner, ringed in dusk so it reads on any tab strip. */
async function drawBadge(iconUrl: string, text: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext("2d")!;
  context.drawImage(await loadImage(iconUrl), 0, 0, SIZE, SIZE);

  context.font = `700 ${text.length > 2 ? 26 : 34}px system-ui, -apple-system, sans-serif`;
  const height = 42;
  const width = Math.max(height, context.measureText(text).width + 16);
  const x = SIZE - width;
  context.fillStyle = token("--color-dusk") || "#211541";
  context.beginPath();
  context.roundRect(x - 3, -3, width + 6, height + 6, (height + 6) / 2);
  context.fill();
  context.fillStyle = token("--color-signal") || "#fa934e";
  context.beginPath();
  context.roundRect(x, 0, width, height, height / 2);
  context.fill();
  context.fillStyle = token("--color-on-signal") || "#2b1408";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x + width / 2, height / 2 + 2);
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
