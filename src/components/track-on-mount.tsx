"use client";

import { useEffect } from "react";

import { track, type ClientEventName, type EventParams } from "@/lib/analytics";

/**
 * Sends one analytics event when it mounts (and again only if its params change), for a server
 * component whose page itself is the event: a dialog opening, a view shown, a return from a provider.
 * Params are the catalog's only (docs/ANALYTICS.md); never pass a name, title, URL or id.
 */
export function TrackOnMount<N extends ClientEventName>({ name, params }: { name: N; params?: EventParams<N> }) {
  const key = JSON.stringify(params ?? {});
  useEffect(() => {
    (track as (name: ClientEventName, params?: Record<string, unknown>) => void)(name, JSON.parse(key) as Record<string, unknown>);
  }, [name, key]);
  return null;
}
