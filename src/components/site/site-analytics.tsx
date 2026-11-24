"use client";

import { useEffect } from "react";

import { redactLocation, track } from "@/lib/analytics";

/**
 * The public site's clicks, as one delegated listener rendered by `SiteHeader` (docs/ANALYTICS.md,
 * "Marketing"). A call to action carries `data-cta` (its id) and `data-cta-location` (`hero`, `nav`,
 * `footer`, `section:<id>`), so the server components that render it stay on the server. A link into
 * the docs from anywhere but the docs themselves is a `docs_nav`, with the doc's slug (`index` for /docs).
 */
export function SiteClicks() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const cta = target?.closest?.<HTMLElement>("[data-cta]");
      if (cta?.dataset.cta) track("cta_click", { cta_id: cta.dataset.cta, location: cta.dataset.ctaLocation ?? "page" });

      const anchor = target?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.origin !== location.origin) return;
      if (redactLocation(location.pathname).surface === "docs") return;
      const doc = /^\/docs(?:\/([a-z0-9-]+))?\/?$/.exec(anchor.pathname);
      if (doc) track("docs_nav", { target: doc[1] ?? "index" });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}

/**
 * A `section_view` when a landing section (`data-section`) is half on screen, once per page view. A
 * section taller than twice the screen never shows half of itself, so filling half the screen counts too.
 */
export function SectionViews() {
  useEffect(() => {
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.section;
          if (!id || seen.has(id) || !entry.isIntersecting) continue;
          if (entry.intersectionRatio < 0.5 && entry.intersectionRect.height < innerHeight / 2) continue;
          seen.add(id);
          observer.unobserve(entry.target);
          track("section_view", { section_id: id });
        }
      },
      { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5] },
    );
    for (const section of document.querySelectorAll("[data-section]")) observer.observe(section);
    return () => observer.disconnect();
  }, []);
  return null;
}
