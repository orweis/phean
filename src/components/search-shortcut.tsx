"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { routes } from "@/lib/routes";

const TYPING = "input, textarea, select, [contenteditable]";

/**
 * `/` starts a search from anywhere in a workspace: it focuses the page's own search box (Memory
 * has one), or opens the Search tab.
 */
export function SearchShortcut({ slug }: { slug: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if ((event.target as Element | null)?.closest?.(TYPING)) return;
      event.preventDefault();
      const box = document.querySelector<HTMLInputElement>("[data-search-input]");
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
