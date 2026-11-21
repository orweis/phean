"use client";

import { useSyncExternalStore } from "react";

import { desktopShell, type PheanDesktop } from "@/lib/desktop";

const subscribe = () => () => {};

/**
 * The desktop shell's API when the page runs inside the desktop app, and undefined in a browser. The
 * server and the first render see undefined, so hydration matches, and the desktop's controls appear after.
 */
export function useDesktopShell(): PheanDesktop | undefined {
  return useSyncExternalStore(subscribe, desktopShell, () => undefined);
}
