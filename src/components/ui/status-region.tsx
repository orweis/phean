"use client";

import { Undo2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";

import { IDLE, type ActionState } from "@/lib/action-state";
import { cx } from "@/lib/cx";

import { buttonClasses } from "./button";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** The reverse of an action that just ran: the transition that already exists (Drop to Restore, Done to Reopen). */
export interface UndoSpec {
  action: FormAction;
  fields: Record<string, string>;
  /** What the region says once the undo has run, e.g. "Restored 'Read the thread'". */
  done?: string;
}

export interface Notice {
  message: string;
  undo?: UndoSpec;
  /** Slug of the workspace the undo posts to. */
  workspace?: string;
  tone?: "plain" | "error";
}

interface Shown extends Notice {
  id: number;
}

interface StatusApi {
  announce: (notice: Notice) => void;
  /** Whether a notice is on screen, so background news never talks over what an action said. */
  isShowing: () => boolean;
}

const StatusContext = createContext<StatusApi | null>(null);

/** The workspace's one status region, or null outside a workspace (forms then report inline). */
export function useStatus(): StatusApi | null {
  return useContext(StatusContext);
}

/** How long a notice stays, unless it is hovered or holds focus. */
export const NOTICE_MS = 6000;

/**
 * One polite `role="status"` region for the whole workspace. Actions say what they did here,
 * naming the object ("Dropped 'Read the thread'"), and offer Undo where the reverse exists. A
 * notice stays about six seconds, longer while it is hovered or focused; Undo is reachable with Tab.
 */
export function StatusRegion({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Shown | null>(null);
  const [held, setHeld] = useState(false);
  const [pending, startTransition] = useTransition();
  const next = useRef(0);
  const showing = useRef(false);
  useEffect(() => {
    showing.current = notice !== null;
  }, [notice]);

  const announce = useCallback((value: Notice) => {
    showing.current = true;
    setNotice({ ...value, id: ++next.current });
  }, []);
  const api = useMemo(() => ({ announce, isShowing: () => showing.current }), [announce]);

  useEffect(() => {
    if (!notice || held || pending) return;
    const timer = setTimeout(() => setNotice((current) => (current?.id === notice.id ? null : current)), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, held, pending]);

  const undo = (shown: Shown) => {
    const spec = shown.undo!;
    const form = new FormData();
    if (shown.workspace) form.set("workspace", shown.workspace);
    for (const [name, value] of Object.entries(spec.fields)) form.set(name, value);
    startTransition(async () => {
      const result = await spec.action(IDLE, form);
      announce(
        result.status === "error"
          ? { message: result.message ?? "Could not undo that.", tone: "error" }
          : { message: spec.done ?? "Undone." },
      );
    });
  };

  return (
    <StatusContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        data-status-region
        className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex justify-center sm:bottom-5"
        onPointerEnter={() => setHeld(true)}
        onPointerLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false);
        }}
      >
        {notice && (
          <div
            key={notice.id}
            data-notice
            className={cx(
              "glass-float pointer-events-auto flex max-w-lg min-w-0 items-center gap-2 rounded-xl py-1.5 pr-1.5 pl-4 text-sm motion-safe:animate-glass-in",
              notice.tone === "error" ? "text-late-ink" : "text-ink",
            )}
          >
            <p className="min-w-0 flex-1 py-1">{notice.message}</p>
            {notice.undo && (
              <button type="button" className={buttonClasses("tinted", "sm")} disabled={pending} aria-busy={pending || undefined} onClick={() => undo(notice)}>
                <Undo2 aria-hidden />
                Undo
              </button>
            )}
            <button type="button" aria-label="Dismiss" className={buttonClasses("ghost", "sm", "px-2")} onClick={() => setNotice(null)}>
              <X aria-hidden />
            </button>
          </div>
        )}
      </div>
    </StatusContext.Provider>
  );
}
