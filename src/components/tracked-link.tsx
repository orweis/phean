"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { sendTracked, type Tracked } from "@/lib/tracked";

/** A `Link` that sends an analytics event when followed, for server components that cannot take a click handler (a tab, a view switch). */
export function TrackedLink({ analytics, onClick, ...link }: ComponentProps<typeof Link> & { analytics?: Tracked }) {
  return (
    <Link
      {...link}
      onClick={(event) => {
        sendTracked(analytics);
        onClick?.(event);
      }}
    />
  );
}
