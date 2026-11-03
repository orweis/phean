import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

export type PanelTone = "plain" | "wait" | "late";

const PANEL_TONES: Record<PanelTone, string> = {
  plain: "border-rule",
  wait: "border-wait/70",
  late: "border-late/40",
};

const HEADER_TONES: Record<PanelTone, string> = {
  plain: "border-rule",
  wait: "border-wait/50 bg-wait-tint",
  late: "border-late/25 bg-late-tint",
};

/** On a tinted header, grey would wash out; the description takes the tone's ink instead. */
const DESCRIPTION_TONES: Record<PanelTone, string> = {
  plain: "text-muted",
  wait: "text-wait-ink",
  late: "text-late-ink",
};

export function Card({ className, tone = "plain", ...props }: ComponentProps<"section"> & { tone?: PanelTone }) {
  return <section data-tone={tone} className={cx("rounded-lg border bg-panel", PANEL_TONES[tone], className)} {...props} />;
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  tone?: PanelTone;
}

export function CardHeader({ title, description, action, tone = "plain" }: CardHeaderProps) {
  return (
    <header
      className={cx(
        "flex items-start justify-between gap-4 rounded-t-[calc(var(--radius-lg)-1px)] border-b px-5 py-3.5",
        HEADER_TONES[tone],
      )}
    >
      <div className="min-w-0">
        <h2 className="text-md font-semibold">{title}</h2>
        {description && <p className={cx("mt-0.5 text-xs", DESCRIPTION_TONES[tone])}>{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("px-5 py-4", className)} {...props} />;
}
