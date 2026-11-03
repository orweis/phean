import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "shell" | "signal";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-shell text-shell-ink hover:bg-shell-2 active:bg-ink",
  secondary: "border border-rule bg-panel text-ink hover:border-edge hover:bg-sunken active:bg-rule",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink active:bg-rule",
  danger: "border border-late/35 bg-panel text-late-ink hover:bg-late-tint active:bg-late-tint",
  /** For controls on the navy header. */
  shell: "text-shell-muted hover:bg-shell-2 hover:text-shell-ink active:bg-ink",
  /** The one call to action on a navy surface. */
  signal: "bg-signal text-signal-ink hover:bg-signal-tint active:bg-signal",
};

/** Small buttons are 32px tall; the pseudo-element extends the hit target to 44px. */
const SIZES: Record<ButtonSize, string> = {
  sm: "relative h-8 gap-1.5 rounded-md px-2.5 text-xs after:absolute after:inset-x-0 after:-inset-y-1.5 [&_svg]:size-3.5",
  md: "h-9 gap-2 rounded-md px-3.5 text-sm [&_svg]:size-4",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cx(
    "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors duration-(--dur-micro)",
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
}

export function Button({ variant, size, className, type = "button", pending = false, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && <LoaderCircle className="motion-safe:animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & ButtonStyleProps) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
