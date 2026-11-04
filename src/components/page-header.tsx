import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Keep the actions on the title's line on phones too, for a compact icon button such as Add manually. */
  inlineActions?: boolean;
}

export function PageHeader({ title, description, actions, inlineActions = false }: PageHeaderProps) {
  return (
    <div className={cx("mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", inlineActions && "max-sm:flex-nowrap max-sm:items-start")}>
      <div className="min-w-0 flex-1 basis-80">
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
