"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { Answered } from "./done-view";

/**
 * What a person answered in Quick Decisions in this tab, per workspace: the progress bar counts it
 * and the done screen lists it. Kept in `sessionStorage`, so a reload mid-queue keeps the count; when
 * storage is refused (a private window), in memory for the life of the page. A per-viewer
 * convenience only: the answers themselves are on the server.
 */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const EMPTY: Answered[] = [];
let cache: { key: string; raw: string | null; value: Answered[] } | null = null;

function load(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function save(key: string, raw: string): void {
  try {
    window.sessionStorage.setItem(key, raw);
  } catch {
    memory.set(key, raw);
  }
}

const isAnswered = (value: unknown): value is Answered => {
  const entry = value as Partial<Answered> | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    [entry.requestId, entry.taskId, entry.question, entry.answer, entry.agentName].every((field) => typeof field === "string") &&
    typeof entry.undoable === "boolean"
  );
};

function read(key: string): Answered[] {
  const raw = load(key);
  if (cache?.key === key && cache.raw === raw) return cache.value;
  let value = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) value = parsed.filter(isAnswered);
  } catch {
    value = EMPTY;
  }
  cache = { key, raw, value };
  return value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const keyOf = (slug: string) => `phean-quick-answered:${slug}`;

/** This tab's answers in the workspace as stored right now, for an effect that must not wait for a render. */
export const answeredNow = (slug: string): readonly Answered[] => read(keyOf(slug));

/** This tab's answers in the workspace, and a way to change them. The server render sees none. */
export function useAnswered(slug: string): [Answered[], (change: (list: Answered[]) => Answered[]) => void] {
  const key = keyOf(slug);
  const list = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => EMPTY,
  );
  const update = useCallback(
    (change: (list: Answered[]) => Answered[]) => {
      save(key, JSON.stringify(change(read(key))));
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [list, update];
}
