"use client";

import type { ComponentProps } from "react";

import { sendTracked, type Tracked } from "@/lib/tracked";

/** A plain `<a>` that sends an analytics event when followed, for server components that cannot take a click handler. */
export function TrackedAnchor({ analytics, onClick, ...anchor }: ComponentProps<"a"> & { analytics: Tracked }) {
  return (
    <a
      {...anchor}
      onClick={(event) => {
        sendTracked(analytics);
        onClick?.(event);
      }}
    />
  );
}
