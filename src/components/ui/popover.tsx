"use client";

import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";

import { cx } from "@/lib/cx";

import { buttonClasses, type ButtonVariant } from "./button";

interface PopoverProps {
  label: ReactNode;
  /** An icon element (not a component: server pages render this client component). */
  icon?: ReactNode;
  children: ReactNode;
  variant?: ButtonVariant;
  /** "link" sets the trigger as a compact text link, for panels that lead elsewhere rather than act. */
  look?: "button" | "link";
  align?: "left" | "right";
  /** A small heading for a form panel ("Edit task"); it also names the panel for screen readers. */
  title?: string;
  /**
   * "inline" opens the panel in the flow under its trigger on phones, so what it answers stays in
   * view; the default is a sheet at the bottom of the screen.
   */
  phone?: "sheet" | "inline";
  /** Names the trigger for screen readers when its visible label is ambiguous ("More actions for …"). */
  triggerLabel?: string;
  /** A narrow panel of menu rows (`Button` size "menu") instead of a form panel. */
  menu?: boolean;
  className?: string;
  triggerClassName?: string;
}

interface PopoverApi {
  close: () => void;
}

const PopoverContext = createContext<PopoverApi | null>(null);

/** The panel the caller sits in, so a form can close it once it has done its work. */
export function usePopover(): PopoverApi | null {
  return useContext(PopoverContext);
}

/** The pseudo-element extends the hit target to 44px, like small buttons. */
const LINK_TRIGGER =
  "relative inline-flex h-8 cursor-pointer items-center gap-1 rounded-sm text-xs font-semibold text-accent-ink after:absolute after:-inset-x-1 after:-inset-y-1.5 hover:underline [&_svg]:size-3.5";

/** The first thing to type into, or the first control, so keyboard users start inside the panel. */
const FOCUS_FIRST = "input:not([type=hidden]):not([type=radio]):not(:disabled), textarea, select, [data-autofocus]";
const FOCUSABLE = "a[href], button:not(:disabled), input:not([type=hidden]):not(:disabled), textarea, select, [tabindex]:not([tabindex='-1'])";

/** Height a panel needs below its trigger before it opens upward instead. */
const ROOM_BELOW = 320;

/**
 * A small disclosure panel built on <details>, so it opens and closes from its trigger without
 * client JavaScript. With it, the panel takes focus when it opens (its first field, or itself),
 * opens upward when there is no room below, and Escape or a click outside closes it and returns
 * focus to the trigger. On phones the panel becomes a sheet at the bottom of the screen, so the
 * content above it stays visible, and it carries its own close button.
 */
export function Popover({
  label,
  icon,
  children,
  variant = "secondary",
  look = "button",
  align = "right",
  title,
  phone = "sheet",
  triggerLabel,
  menu = false,
  className,
  triggerClassName,
}: PopoverProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    const details = ref.current;
    if (!details?.open) return;
    const hadFocus = details.contains(document.activeElement) || document.activeElement === document.body;
    details.open = false;
    if (hadFocus) details.querySelector("summary")?.focus();
  }, []);
  const api = useMemo(() => ({ close }), [close]);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      event.preventDefault();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) details.open = false;
    };
    const onToggle = () => {
      if (!details.open) return;
      const trigger = details.querySelector("summary")!.getBoundingClientRect();
      const below = window.innerHeight - trigger.bottom;
      details.dataset.side = below < ROOM_BELOW && trigger.top > below ? "top" : "bottom";
      const box = panel.current;
      if (!box) return;
      const target = box.querySelector<HTMLElement>(FOCUS_FIRST) ?? box.querySelector<HTMLElement>(FOCUSABLE) ?? box;
      target.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    details.addEventListener("toggle", onToggle);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      details.removeEventListener("toggle", onToggle);
    };
  }, [close]);

  const inline = phone === "inline";
  return (
    <details ref={ref} data-menu className={cx("group/pop relative", inline && "max-sm:open:basis-full")}>
      <summary
        aria-label={triggerLabel}
        className={cx(
          look === "link" ? LINK_TRIGGER : cx(buttonClasses(variant, "sm"), variant === "ghost" && "group-open/pop:bg-fill group-open/pop:text-ink"),
          "list-none [&::-webkit-details-marker]:hidden",
          triggerClassName,
        )}
      >
        {icon}
        {label}
      </summary>
      <div
        ref={panel}
        tabIndex={-1}
        role={title ? "group" : undefined}
        aria-label={title}
        className={cx(
          "glass-float absolute z-40 rounded-xl outline-none motion-safe:animate-glass-in",
          menu ? "w-56 p-1.5" : "w-80 p-4",
          "sm:mt-2 sm:origin-top sm:group-data-[side=top]/pop:bottom-full sm:group-data-[side=top]/pop:mt-0 sm:group-data-[side=top]/pop:mb-2 sm:group-data-[side=top]/pop:origin-bottom",
          inline
            ? "max-sm:static max-sm:mt-2 max-sm:w-full"
            : "max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:w-auto max-sm:origin-bottom max-sm:overflow-y-auto",
          align === "right" ? "sm:right-0" : "sm:left-0",
          className,
        )}
      >
        {(title || !inline) && (
          <div className={cx("mb-3 flex items-center justify-between gap-2", !title && "-mt-2 -mr-2 sm:hidden", menu && "mt-0 mr-0 mb-1 pl-2.5")}>
            {title && <p className="text-sm font-semibold text-ink">{title}</p>}
            <button type="button" aria-label="Close" className={buttonClasses("ghost", "sm", cx("-my-1 -mr-2 px-2", !inline && title && "sm:hidden", inline && "hidden"))} onClick={close}>
              <X aria-hidden />
            </button>
          </div>
        )}
        <PopoverContext.Provider value={api}>{children}</PopoverContext.Provider>
      </div>
    </details>
  );
}

/** A ghost Cancel for a form panel: closes it without saving. */
export function PopoverCancel({ children = "Cancel" }: { children?: ReactNode }) {
  const popover = usePopover();
  if (!popover) return null;
  return (
    <button type="button" className={buttonClasses("ghost", "sm")} onClick={popover.close}>
      {children}
    </button>
  );
}
