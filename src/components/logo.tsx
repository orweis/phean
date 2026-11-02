import Link from "next/link";

import { cx } from "@/lib/cx";

/** A boulder resting on a slope. The slope takes the text colour, so the mark works on the navy shell and on the sheet. */
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M3 26 L29 10" className="stroke-current" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="15.2" cy="11.1" r="5" className="fill-signal" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cx("flex items-center gap-2 text-lg font-extrabold font-stretch-wordmark", className)}>
      <LogoMark />
      Phean
    </Link>
  );
}
