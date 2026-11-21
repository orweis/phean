"use client";

import { useEffect } from "react";

import { lastWorkspaceCookie } from "@/lib/last-workspace";

/** Remembers the workspace on screen, so `/w` reopens it next time. Renders nothing. */
export function RememberWorkspace({ slug }: { slug: string }) {
  useEffect(() => {
    document.cookie = lastWorkspaceCookie(slug, location.protocol === "https:");
  }, [slug]);
  return null;
}
