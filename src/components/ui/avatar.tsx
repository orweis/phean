import { Bot, User } from "lucide-react";

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

/**
 * Who acted, told apart by shape rather than hue: an agent is a squared tile with a bot, a person
 * a round disc. Violet stays for state, so both are neutral.
 */
export function ActorAvatar({ type, className }: { type: string; className?: string }) {
  const agent = type === "agent";
  const Icon = agent ? Bot : User;
  return (
    <span
      role="img"
      aria-label={agent ? "Agent" : "Person"}
      className={cx("mt-0.5 flex size-6 shrink-0 items-center justify-center bg-fill text-ink-2", agent ? "rounded-xs" : "rounded-full", className)}
    >
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}
