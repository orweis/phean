"use client";

import { useEffect } from "react";

import { routes } from "@/lib/routes";
import { DELETED_NOTICE_COOKIE, deletedNotice } from "@/lib/workspace-deletion";

/**
 * Says which workspace was just deleted, once: the delete action leaves its name in a cookie that
 * lives a minute, and this forgets it as soon as the notice is on screen.
 */
export function DeletedWorkspaceNotice({ name }: { name: string }) {
  useEffect(() => {
    document.cookie = `${DELETED_NOTICE_COOKIE}=; Path=${routes.workspaces()}; Max-Age=0; SameSite=Lax`;
  }, []);
  return (
    <p role="status" className="rounded-md border border-arrive/30 bg-arrive-tint px-4 py-2.5 text-sm text-arrive-ink">
      {deletedNotice(name)}. Everything in it was deleted with it.
    </p>
  );
}
