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

/**
 * Puts the count of what waits on a person (decisions, approvals, new inbox tasks) on the tab's
 * favicon, the way mail apps show unread mail, so a person sees it from another tab. Its own icon
 * link goes last in the head, which browsers prefer; with nothing waiting it is removed and the
 * plain mark shows. The workspace's auto-refresh keeps the count current.
 */
export function FaviconBadge({ count }: { count: number }) {
  useEffect(() => {
    const text = faviconBadgeText(count);
    if (!text) return;
    const plain = document.querySelector<HTMLLinkElement>('link[rel~="icon"]:not([data-badge])');
    if (!plain) return;
    let link: HTMLLinkElement | null = null;
    let cancelled = false;
    void drawBadge(plain.href, text)
      .then((href) => {
        if (cancelled) return;
        link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/png";
        link.href = href;
        link.dataset.badge = text;
        document.head.querySelector("link[data-badge]")?.remove();
        document.head.append(link);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      link?.remove();
    };
  }, [count]);
  return null;
}
