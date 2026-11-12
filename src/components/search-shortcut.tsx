"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { routes } from "@/lib/routes";

const TYPING = "input, textarea, select, [contenteditable]";

/**
 * `/` starts a search from anywhere in a workspace: it focuses the page's own search box (Memory
 * has one), else the header's (hidden on phones), else opens the Search tab.
 */
export function SearchShortcut({ slug }: { slug: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if ((event.target as Element | null)?.closest?.(TYPING)) return;
      event.preventDefault();
      // The page's own box first (Memory filters itself), then the header's, then the Search tab.
      const box = [...document.querySelectorAll<HTMLInputElement>('[data-search-input="page"], [data-search-input="header"]')]
        .filter((candidate) => candidate.offsetParent !== null)
        .sort((a, b) => Number(b.dataset.searchInput === "page") - Number(a.dataset.searchInput === "page"))[0];
      if (box) {
        box.focus();
        box.select();
      } else {
        router.push(routes.search(slug));
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, slug]);
  return null;
}
