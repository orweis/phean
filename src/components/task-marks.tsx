"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";
import { TASK_STATUS_META, type TaskStatus } from "@/lib/domain";
import { routes } from "@/lib/routes";

import { STATION_STYLE } from "./charts/stations";

/**
 * A task's station as a dot, with its name for screen readers, so status never rests on colour
 * alone. The thin edge ring keeps the pale stations (backlog, to do) at 3:1 against a panel.
 */
export function StationDot({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <>
      <span aria-hidden className={cx("size-2 shrink-0 rounded-full ring-1 ring-edge/70", status === "dropped" ? "bg-fill" : STATION_STYLE[status].fill, className)} />
      <span className="sr-only">{`${TASK_STATUS_META[status].label}: `}</span>
    </>
  );
}

/** "Waiting on you" in the ember's ink, where a badge would not fit (a calendar day, a map node). */
export function WaitingNote({ kind, className }: { kind: "question" | "decision"; className?: string }) {
  return <span className={cx("shrink-0 font-semibold text-wait-ink", className)}>{kind === "decision" ? "Decision for you" : "Waiting on you"}</span>;
}

/**
 * A link that opens a task in the side peek, and says so while it is open: `aria-current` and
 * `data-selected`, the way a board card does, so a row, a day or a node shows which task the
 * sheet beside it is about. Style the selected state from the link or its row (`has-[[data-selected]]`).
 */
export function TaskPeekLink({ slug, taskId, ...link }: Omit<ComponentProps<typeof Link>, "href"> & { slug: string; taskId: string }) {
  const selected = usePathname().endsWith(`/tasks/${taskId}`);
  return <Link href={routes.task(slug, taskId)} scroll={false} aria-current={selected || undefined} data-selected={selected || undefined} {...link} />;
}
