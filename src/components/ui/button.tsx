import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "tinted" | "secondary" | "ghost" | "danger" | "dusk" | "signal";
export type ButtonSize = "sm" | "md" | "lg" | "menu";

const VARIANTS: Record<ButtonVariant, string> = {
  /** The prominent action of a view; keep it to one or two per screen. */
  primary: "bg-accent text-on-accent hover:bg-accent-2 active:bg-accent-2",
  /** The forward step repeated on every row of a list, coloured but not prominent. */
  tinted: "bg-accent-tint text-accent-ink hover:bg-accent/20 active:bg-accent/25",
  secondary: "bg-fill text-ink hover:bg-rule active:bg-rule",
  ghost: "text-ink-2 hover:bg-fill hover:text-ink active:bg-rule",
  danger: "bg-late-tint text-late-ink hover:bg-late/20 active:bg-late/25",
  /** For quiet controls on a dusk band. */
  dusk: "text-dusk-muted hover:bg-dusk-2 hover:text-dusk-ink active:bg-dusk-2",
  /** The one call to action on a dusk band: the ember of the logo's boulder. */
  signal: "bg-signal text-on-signal hover:bg-signal-2 active:bg-signal-2",
};

/** Small buttons are 32px tall; the pseudo-element extends the hit target to 44px. */
const SIZES: Record<ButtonSize, string> = {
  sm: "relative h-8 justify-center gap-1.5 rounded-full px-3 text-xs after:absolute after:inset-x-0 after:-inset-y-1.5 [&_svg]:size-3.5",
  md: "h-9 justify-center gap-2 rounded-full px-4 text-sm [&_svg]:size-4",
  /** The marketing site's calls to action, 48px tall. */
  lg: "h-12 justify-center gap-2 rounded-full px-6 text-md [&_svg]:size-4",
  /** A row of a menu panel: full width, its label at the start, 36px tall. */
  menu: "h-9 w-full justify-start gap-2 rounded-md px-2.5 text-sm [&_svg]:size-4 [&_svg]:text-muted",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cx(
    "inline-flex shrink-0 items-center font-semibold whitespace-nowrap transition-colors duration-(--dur-micro)",
    "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

interface ButtonProps extends ComponentProps<"button">, ButtonStyleProps {
  /** While its work runs, the button is disabled and shows a spinner. */
  pending?: boolean;
  /** Shown instead of the spinner while pending, e.g. a tick on Done. */
  pendingIcon?: ReactNode;
}

export function Button({ variant, size, className, type = "button", pending = false, pendingIcon, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && (pendingIcon ?? <LoaderCircle className="motion-safe:animate-spin" aria-hidden />)}
      {children}
    </button>
  );
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & ButtonStyleProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
