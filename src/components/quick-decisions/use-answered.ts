"use client";

import { useCallback, useSyncExternalStore } from "react";

import { freshAnswered, type AnsweredEntry } from "@/lib/quick-decisions";

/**
 * What a person answered in Quick Decisions in this tab, per person and workspace: the progress bar
 * counts it and the done screen lists it. Only request ids and a short label are kept, in
 * `sessionStorage` (in memory when storage is refused), for at most `ANSWERED_TTL_MS`, and it is
 * forgotten on sign-out and when Quick Decisions is closed. A per-viewer convenience only: the
 * answers themselves are on the server.
 */
const PREFIX = "phean-quick-answered:";
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const EMPTY: AnsweredEntry[] = [];
let cache: { key: string; raw: string | null; value: AnsweredEntry[] } | null = null;

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

function read(key: string): AnsweredEntry[] {
  const raw = load(key);
  if (cache?.key === key && cache.raw === raw) return cache.value;
  let value = EMPTY;
  try {
    const entries = raw ? freshAnswered(JSON.parse(raw), Date.now()) : [];
    if (entries.length) value = entries;
  } catch {
    value = EMPTY;
  }
  cache = { key, raw, value };
  return value;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const keyOf = (userId: string, slug: string) => `${PREFIX}${userId}:${slug}`;

/** Forgets what every person answered in this tab: on sign-out, so the next person here sees none of it. */
export function forgetQuickAnswers(): void {
  memory.clear();
  try {
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith(PREFIX)));
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch {
    // Storage refused: the memory copy above was all there was.
  }
  cache = null;
  notify();
}

/** This person's answers in the workspace as stored right now, for an effect that must not wait for a render. */
export const answeredNow = (userId: string, slug: string): readonly AnsweredEntry[] => read(keyOf(userId, slug));

/** This person's answers in the workspace in this tab, and a way to change them. The server render sees none. */
export function useAnswered(userId: string, slug: string): [AnsweredEntry[], (change: (list: AnsweredEntry[]) => AnsweredEntry[]) => void] {
  const key = keyOf(userId, slug);
  const list = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => EMPTY,
  );
  const update = useCallback(
    (change: (list: AnsweredEntry[]) => AnsweredEntry[]) => {
      save(key, JSON.stringify({ savedAt: Date.now(), entries: change(read(key)) }));
      notify();
    },
    [key],
  );
  return [list, update];
}
