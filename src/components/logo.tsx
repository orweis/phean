import Link from "next/link";

import { cx } from "@/lib/cx";

/** Shared with the app icons, which draw the same mark on a dusk ground. */
export const MARK = {
  hill: "M1 30C13 29.5 23 22 31 5V31H1Z",
  /** The same slope carried past the edges, for a full-bleed icon tile. */
  tileHill: "M-1 30.05L1 30C13 29.5 23 22 31 5L32.5 1.8V33H-1Z",
  boulder: { cx: 12.65, cy: 19.17, r: 6.4 },
  lit: "M6.4 20.53A6.4 6.4 0 0 1 15.71 13.55A5.9 5.9 0 1 1 6.4 20.53Z",
} as const;

/** The boulder on the hill it is rolled up: a violet slope that steepens, an ember boulder lit from the upper left. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d={MARK.hill} className="fill-hill" />
      <circle {...MARK.boulder} className="fill-signal-shade" />
      <path d={MARK.lit} className="fill-signal" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cx("flex items-center gap-2 text-lg font-bold tracking-title", className)}>
      <LogoMark />
      Phean
    </Link>
  );
}
