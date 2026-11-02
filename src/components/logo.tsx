import Link from "next/link";

/** A boulder on a slope. */
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-zinc-900" />
      <path d="M5 25 L27 13" className="stroke-zinc-500" strokeWidth="2" strokeLinecap="round" />
      <circle cx="17.5" cy="13" r="5" className="fill-violet-400" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-sm font-semibold tracking-tight text-zinc-900">
      <LogoMark />
      Phean
    </Link>
  );
}
