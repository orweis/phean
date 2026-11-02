import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-xl border border-zinc-200 bg-white shadow-xs", className)} {...props} />;
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}

export function CardHeader({ title, description, action, icon }: CardHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-zinc-400 [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
        </div>
      </div>
      {action}
    </header>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("px-5 py-4", className)} {...props} />;
}
