import { cx } from "@/lib/cx";

const SIZES = { sm: "size-6 text-2xs", md: "size-8 text-sm" } as const;

/** A person's initial on a violet disc. Decorative: their name is always written beside it. */
export function Avatar({ name, size = "md" }: { name: string; size?: keyof typeof SIZES }) {
  return (
    <span aria-hidden className={cx("flex shrink-0 items-center justify-center rounded-full bg-accent-tint font-bold text-accent-ink", SIZES[size])}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
