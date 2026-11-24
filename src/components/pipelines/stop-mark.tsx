import { Bot, Check, CircleOff, Flag, Hand, Hourglass, Minus, Play, SkipForward, Slash, UserRound, X, type LucideIcon } from "lucide-react";

import { STOP_VIEW_META, type StopKind, type StopViewState } from "@/lib/domain";
import { cx } from "@/lib/cx";

import { Badge } from "../ui/badge";
import { STOP_STYLE } from "../charts/stations";

/** Each state's icon: a state is an icon, a word and a line form, never a hue alone. */
export const STOP_ICON: Record<StopViewState, LucideIcon> = {
  upcoming: Minus,
  handing_off: Hand,
  active: Play,
  waiting: Hourglass,
  done: Check,
  failed: X,
  skipped: SkipForward,
  not_reached: CircleOff,
  cancelled: Slash,
};

export const KIND_ICON: Record<StopKind, LucideIcon> = { agent: Bot, any_agent: Bot, person: UserRound, pipeline: Flag };

/** A stop's dot: the state's icon in its line form. Decorative; the word goes beside it or in a list. */
export function StopDot({ state, size = "md", className }: { state: StopViewState; size?: "sm" | "md"; className?: string }) {
  const Icon = STOP_ICON[state];
  return (
    <span
      aria-hidden
      data-stop-state={state}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        size === "sm" ? "size-4 [&_svg]:size-2.5" : "size-6 [&_svg]:size-3.5",
        STOP_STYLE[state].dot,
        className,
      )}
    >
      <Icon strokeWidth={2.5} />
    </span>
  );
}

/** The state in words, with its icon, as a badge in its tone. */
export function StopStateBadge({ state, waitingOn }: { state: StopViewState; waitingOn?: string | null }) {
  const Icon = STOP_ICON[state];
  const { label, tone } = STOP_VIEW_META[state];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {state === "waiting" && waitingOn ? `Waiting on ${waitingOn}` : label}
    </Badge>
  );
}
