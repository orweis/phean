import { Target } from "lucide-react";
import Link from "next/link";

import { routes } from "@/lib/routes";

/** The goal an item is filed under, as a compact link in its meta row. */
export function GoalLink({ slug, goalId, title }: { slug: string; goalId: string; title: string }) {
  return (
    <Link
      href={routes.goal(slug, goalId)}
      title={title}
      className="relative inline-flex max-w-56 items-center gap-1 after:absolute after:inset-x-0 after:-inset-y-1.5 hover:text-ink link"
    >
      <Target className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{title}</span>
    </Link>
  );
}
